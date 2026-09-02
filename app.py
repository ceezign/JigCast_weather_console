"""
app.py

"""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from utils.weather import WeatherService, WeatherServiceError

load_dotenv()

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger(__name__)


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["JSON_SORT_KEYS"] = False

    api_key = os.environ.get("OPENWEATHER_API_KEY", "").strip()
    units = os.environ.get("WEATHER_UNITS", "metric").strip() or "metric"

    if not api_key:
        logger.warning(
            "OPENWEATHER_API_KEY is not set. /api/weather will return a 500 "
            "until it's configured in your .env file."
        )

    weather_service = WeatherService(api_key=api_key, units=units)

    # ---- Pages -----------------------------------------------------------

    @app.route("/")
    def index():
        return render_template("index.html", units=units)

    # ---- API ---------------------------------------------------------------

    @app.route("/api/weather")
    def api_weather():
        city = request.args.get("city", "")
        try:
            data = weather_service.get_weather_for_city(city)
            return jsonify({"ok": True, "data": data})
        except WeatherServiceError as exc:
            logger.info("Handled weather error for query %r: %s", city, exc.message)
            return jsonify({"ok": False, "error": exc.message}), exc.http_status
        except Exception:  # noqa: BLE001 - last line of defense, never leak internals
            logger.exception("Unhandled error while fetching weather for %r", city)
            return jsonify({
                "ok": False,
                "error": "Something unexpected happened on our end. Please try again.",
            }), 500

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    # ---- Fallback error handlers ------------------------------------------

    @app.errorhandler(404)
    def not_found(_error):
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "error": "That endpoint doesn't exist."}), 404
        return render_template("index.html", units=units), 404

    @app.errorhandler(500)
    def server_error(_error):
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "error": "Internal server error."}), 500
        return render_template("index.html", units=units), 500

    return app


app = create_app()


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=debug)
