"""
utils/weather.py

"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone
from statistics import mean
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)

GEOCODE_URL = "https://api.openweathermap.org/geo/1.0/direct"
CURRENT_WEATHER_URL = "https://api.openweathermap.org/data/2.5/weather"
FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast"

REQUEST_TIMEOUT_SECONDS = 8


# Errors

class WeatherServiceError(Exception):
    """Base class for all handled errors. Safe to show `message` to users."""

    http_status = 500
    message = "Something went wrong while fetching the weather. Please try again."

    def __init__(self, message: Optional[str] = None, http_status: Optional[int] = None):
        self.message = message or self.message
        self.http_status = http_status or self.http_status
        super().__init__(self.message)


class LocationNotFoundError(WeatherServiceError):
    http_status = 404
    message = "We couldn't find that location. Check the spelling and try again."


class InvalidInputError(WeatherServiceError):
    http_status = 400
    message = "Please enter a city name to search."


class ApiKeyMissingError(WeatherServiceError):
    http_status = 500
    message = "The weather service isn't configured yet. Missing API key."


class ApiKeyInvalidError(WeatherServiceError):
    http_status = 502
    message = "The weather service rejected our credentials. Please try again later."


class RateLimitError(WeatherServiceError):
    http_status = 429
    message = "We're getting too many requests right now. Please wait a moment and try again."


class UpstreamTimeoutError(WeatherServiceError):
    http_status = 504
    message = "The weather service took too long to respond. Please try again."


class UpstreamUnavailableError(WeatherServiceError):
    http_status = 502
    message = "The weather service is currently unavailable. Please try again shortly."


class UnexpectedResponseError(WeatherServiceError):
    http_status = 502
    message = "We received an unexpected response from the weather service."


# Service

class WeatherService:
    """Handles all communication with OpenWeatherMap for a given API key."""

    def __init__(self, api_key: Optional[str], units: str = "metric"):
        self.api_key = api_key
        self.units = units

    # ---- public API

    def get_weather_for_city(self, query: str) -> dict[str, Any]:
        """
        Resolve a free-text location query and return a combined payload of
        current conditions + daily forecast + raw 3-hour series for charts.
        """
        query = (query or "").strip()
        if not query:
            raise InvalidInputError()
        if len(query) > 100:
            raise InvalidInputError("That location name looks too long. Try a shorter search.")

        self._ensure_api_key()

        location = self._geocode(query)
        current = self._fetch_current(location["lat"], location["lon"])
        forecast_raw = self._fetch_forecast(location["lat"], location["lon"])

        return {
            "location": location,
            "current": current,
            "forecast": self._aggregate_daily_forecast(forecast_raw),
            "series": self._build_series(forecast_raw),
            "units": self.units,
        }

    # ---- HTTP helpers ------------------------------------------------------

    def _ensure_api_key(self) -> None:
        if not self.api_key:
            logger.error("OPENWEATHER_API_KEY is not set")
            raise ApiKeyMissingError()

    def _request(self, url: str, params: dict[str, Any]) -> Any:
        params = {**params, "appid": self.api_key}
        try:
            response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
        except requests.exceptions.Timeout as exc:
            logger.warning("Upstream timeout calling %s: %s", url, exc)
            raise UpstreamTimeoutError() from exc
        except requests.exceptions.ConnectionError as exc:
            logger.warning("Upstream connection error calling %s: %s", url, exc)
            raise UpstreamUnavailableError() from exc
        except requests.exceptions.RequestException as exc:
            logger.error("Unexpected requests error calling %s: %s", url, exc)
            raise UpstreamUnavailableError() from exc

        if response.status_code == 401:
            logger.error("OpenWeatherMap rejected the API key (401)")
            raise ApiKeyInvalidError()
        if response.status_code == 404:
            raise LocationNotFoundError()
        if response.status_code == 429:
            raise RateLimitError()
        if response.status_code >= 500:
            raise UpstreamUnavailableError()
        if response.status_code >= 400:
            # Any other 4xx we didn't anticipate
            logger.warning("Unhandled 4xx from %s: %s %s", url, response.status_code, response.text[:300])
            raise UnexpectedResponseError()

        try:
            return response.json()
        except ValueError as exc:
            logger.error("Non-JSON response from %s: %s", url, exc)
            raise UnexpectedResponseError() from exc

    # ---- Geocoding ---------------------------------------------------------

    def _geocode(self, query: str) -> dict[str, Any]:
        data = self._request(GEOCODE_URL, {"q": query, "limit": 1})
        if not isinstance(data, list) or len(data) == 0:
            raise LocationNotFoundError()

        place = data[0]
        try:
            return {
                "name": place["name"],
                "country": place.get("country", ""),
                "state": place.get("state"),
                "lat": place["lat"],
                "lon": place["lon"],
            }
        except KeyError as exc:
            logger.error("Malformed geocode payload: %s", place)
            raise UnexpectedResponseError() from exc

    # ---- Current weather -----------------------------------------------------

    def _fetch_current(self, lat: float, lon: float) -> dict[str, Any]:
        data = self._request(
            CURRENT_WEATHER_URL,
            {"lat": lat, "lon": lon, "units": self.units},
        )
        try:
            weather = data["weather"][0]
            main = data["main"]
            wind = data.get("wind", {})
            sys = data.get("sys", {})
            return {
                "temp": round(main["temp"]),
                "feels_like": round(main["feels_like"]),
                "temp_min": round(main.get("temp_min", main["temp"])),
                "temp_max": round(main.get("temp_max", main["temp"])),
                "humidity": main["humidity"],
                "pressure": main["pressure"],
                "condition": weather["main"],
                "description": weather["description"].capitalize(),
                "icon": weather["icon"],
                "wind_speed": wind.get("speed", 0),
                "wind_deg": wind.get("deg", 0),
                "clouds": data.get("clouds", {}).get("all", 0),
                "visibility": data.get("visibility"),
                "sunrise": sys.get("sunrise"),
                "sunset": sys.get("sunset"),
                "timezone_offset": data.get("timezone", 0),
                "dt": data.get("dt"),
            }
        except (KeyError, IndexError) as exc:
            logger.error("Malformed current weather payload: %s", data)
            raise UnexpectedResponseError() from exc

    # ---- Forecast ------------------------------------------------------------

    def _fetch_forecast(self, lat: float, lon: float) -> list[dict[str, Any]]:
        data = self._request(
            FORECAST_URL,
            {"lat": lat, "lon": lon, "units": self.units},
        )
        entries = data.get("list")
        if not isinstance(entries, list):
            logger.error("Malformed forecast payload: missing 'list'")
            raise UnexpectedResponseError()
        return entries

    def _build_series(self, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """3-hour resolution series used to draw the temperature/precip charts."""
        series = []
        for entry in entries:
            try:
                series.append({
                    "dt": entry["dt"],
                    "label": datetime.fromtimestamp(entry["dt"], tz=timezone.utc).strftime("%a %H:%M"),
                    "temp": round(entry["main"]["temp"], 1),
                    "feels_like": round(entry["main"]["feels_like"], 1),
                    "pop": round(entry.get("pop", 0) * 100),
                    "humidity": entry["main"]["humidity"],
                    "condition": entry["weather"][0]["main"],
                    "icon": entry["weather"][0]["icon"],
                })
            except (KeyError, IndexError):
                continue
        return series

    def _aggregate_daily_forecast(self, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        The free /forecast endpoint returns 3-hour steps for 5 days. Group
        those into per-day summaries so the UI can show clean daily cards.
        """
        by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for entry in entries:
            date_key = datetime.fromtimestamp(entry["dt"], tz=timezone.utc).strftime("%Y-%m-%d")
            by_date[date_key].append(entry)

        days = []
        for date_key in sorted(by_date.keys()):
            bucket = by_date[date_key]
            temps = [e["main"]["temp"] for e in bucket]
            feels = [e["main"]["feels_like"] for e in bucket]
            humidities = [e["main"]["humidity"] for e in bucket]
            winds = [e["wind"]["speed"] for e in bucket if "wind" in e]
            pops = [e.get("pop", 0) for e in bucket]

            # Prefer the entry closest to midday for a representative icon/condition
            midday_entry = min(
                bucket,
                key=lambda e: abs(
                    datetime.fromtimestamp(e["dt"], tz=timezone.utc).hour - 12
                ),
            )

            days.append({
                "date": date_key,
                "day_name": datetime.strptime(date_key, "%Y-%m-%d").strftime("%A"),
                "day_short": datetime.strptime(date_key, "%Y-%m-%d").strftime("%a %d %b"),
                "temp_max": round(max(temps)),
                "temp_min": round(min(temps)),
                "feels_like": round(mean(feels)),
                "humidity": round(mean(humidities)),
                "wind_speed": round(mean(winds), 1) if winds else 0,
                "pop": round(max(pops) * 100),
                "condition": midday_entry["weather"][0]["main"],
                "description": midday_entry["weather"][0]["description"].capitalize(),
                "icon": midday_entry["weather"][0]["icon"],
            })

        # The 5-day/3-hour endpoint often includes a partial trailing day; keep
        # at most 5 full-ish days for a clean, predictable UI.
        return days[:6]
