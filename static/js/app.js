/**
 * app.js — weather console frontend.
 *
 * Talks only to our own Flask API (/api/weather). No API keys, no direct
 * calls to OpenWeatherMap from the browser.
 */
(() => {
  'use strict';

  // ---- DOM references

  const els = {
    form: document.getElementById('search-form'),
    input: document.getElementById('city-input'),
    searchBtn: document.getElementById('search-btn'),
    quickPicks: document.getElementById('quick-picks'),

    emptyState: document.getElementById('empty-state'),
    loadingState: document.getElementById('loading-state'),
    loadingCity: document.getElementById('loading-city'),
    errorState: document.getElementById('error-state'),
    errorTitle: document.getElementById('error-title'),
    errorMessage: document.getElementById('error-message'),
    retryBtn: document.getElementById('retry-btn'),
    results: document.getElementById('results'),

    body: document.body,
    unitPill: document.getElementById('unit-pill'),

    locName: document.getElementById('loc-name'),
    locMeta: document.getElementById('loc-meta'),
    tempValue: document.getElementById('temp-value'),
    tempUnit: document.getElementById('temp-unit'),
    heroIcon: document.getElementById('hero-icon'),
    heroCondition: document.getElementById('hero-condition'),
    feelsLike: document.getElementById('feels-like'),
    tempMax: document.getElementById('temp-max'),
    tempMin: document.getElementById('temp-min'),

    explainerIcon: document.getElementById('explainer-icon'),
    explainerTitle: document.getElementById('explainer-title'),
    explainerBody: document.getElementById('explainer-body'),

    statHumidity: document.getElementById('stat-humidity'),
    statWind: document.getElementById('stat-wind'),
    statPressure: document.getElementById('stat-pressure'),
    statVisibility: document.getElementById('stat-visibility'),
    statClouds: document.getElementById('stat-clouds'),
    statSunrise: document.getElementById('stat-sunrise'),
    statSunset: document.getElementById('stat-sunset'),
    statWindDir: document.getElementById('stat-wind-dir'),

    forecastTrack: document.getElementById('forecast-track'),

    sceneSun: document.querySelector('.scene-sun'),
    sceneCloud1: document.querySelector('.scene-cloud.c1'),
    sceneCloud2: document.querySelector('.scene-cloud.c2'),
    sceneRain: document.getElementById('scene-rain'),
    sceneSnow: document.getElementById('scene-snow'),
    sceneBolt: document.getElementById('scene-bolt'),
    sceneFog: document.getElementById('scene-fog'),
  };

  const UNITS = (document.documentElement.dataset.units) || 'metric';
  const isImperial = UNITS === 'imperial';
  const TEMP_SUFFIX = isImperial ? '°F' : '°C';
  const SPEED_SUFFIX = isImperial ? 'mph' : 'm/s';

  els.unitPill.textContent = TEMP_SUFFIX;
  els.tempUnit.textContent = TEMP_SUFFIX;

  // ---- Condition metadata

  const CONDITION_INFO = {
    Clear: {
      emoji: '☀️',
      title: 'Clear skies',
      body: 'No significant cloud cover. Expect strong, direct sunlight during the day and rapid cooling after sunset.',
    },
    Clouds: {
      emoji: '☁️',
      title: 'Cloudy',
      body: 'Cloud cover is dominating the sky. Sunlight may be diffused or blocked; temperatures tend to stay more even through the day.',
    },
    Rain: {
      emoji: '🌧️',
      title: 'Rain',
      body: 'Liquid precipitation is falling. Roads may be slick — carry a waterproof layer and check for updates before heading out.',
    },
    Drizzle: {
      emoji: '🌦️',
      title: 'Drizzle',
      body: 'Light, fine droplets are falling steadily. It rarely feels heavy, but it can soak through fabric over time.',
    },
    Thunderstorm: {
      emoji: '⛈️',
      title: 'Thunderstorm',
      body: 'Storm cells are producing lightning and heavy rain. Avoid open areas and tall isolated structures until it passes.',
    },
    Snow: {
      emoji: '❄️',
      title: 'Snow',
      body: 'Frozen precipitation is falling. Watch for reduced visibility and slippery surfaces on roads and walkways.',
    },
    Mist: {
      emoji: '🌫️',
      title: 'Mist',
      body: 'Suspended water droplets are lowering visibility close to the ground. Drive with headlights on and increase following distance.',
    },
    Fog: {
      emoji: '🌫️',
      title: 'Fog',
      body: 'Dense low-lying cloud is cutting visibility significantly. Delays are possible for road, air, and sea travel.',
    },
    Haze: {
      emoji: '🌫️',
      title: 'Haze',
      body: 'Fine particles are scattering light and dulling visibility. Sensitive groups may want to limit prolonged outdoor exertion.',
    },
    Smoke: {
      emoji: '🌫️',
      title: 'Smoke',
      body: 'Airborne smoke particles are present. Air quality may be reduced — consider limiting outdoor activity if it lingers.',
    },
    Dust: {
      emoji: '🌪️',
      title: 'Dust',
      body: 'Wind-blown dust or sand is reducing visibility. Protect eyes and airways if heading outside.',
    },
    Squall: {
      emoji: '💨',
      title: 'Squall',
      body: 'A sudden, sharp increase in wind speed is occurring, often ahead of a storm front. Secure loose outdoor items.',
    },
    Tornado: {
      emoji: '🌪️',
      title: 'Tornado',
      body: 'Extreme rotating wind conditions have been reported. Seek sturdy shelter immediately and monitor official alerts.',
    },
  };

  function conditionInfo(condition) {
    return CONDITION_INFO[condition] || {
      emoji: '🌤️',
      title: condition || 'Current conditions',
      body: 'Conditions are being reported by the nearest weather station.',
    };
  }

  function conditionKey(condition) {
    return (condition || '').toLowerCase();
  }

  // ---- Helpers

  function iconUrl(icon, size = '2x') {
    return `https://openweathermap.org/img/wn/${icon}@${size}.png`;
  }

  function formatTime(unixSeconds) {
    if (!unixSeconds) return '—';
    const d = new Date(unixSeconds * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function degToCompass(deg) {
    if (deg === undefined || deg === null) return '—';
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const idx = Math.round(deg / 22.5) % 16;
    return dirs[idx];
  }

  function metersToVisibilityLabel(meters) {
    if (meters === undefined || meters === null) return '—';
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${meters} m`;
  }

  // ---- State transitions

  function showState(name) {
    els.emptyState.hidden = name !== 'empty';
    els.loadingState.hidden = name !== 'loading';
    els.errorState.hidden = name !== 'error';
    els.results.hidden = name !== 'results';
  }

  function setSearching(isSearching) {
    els.searchBtn.disabled = isSearching;
    els.input.disabled = isSearching;
  }

  // ---- Scene control

  function applyScene(condition) {
    const key = conditionKey(condition);
    els.body.dataset.condition = key || 'default';

    const isClear = key === 'clear';
    const isClouds = key === 'clouds';
    const isRain = ['rain', 'drizzle'].includes(key);
    const isStorm = key === 'thunderstorm';
    const isSnow = key === 'snow';
    const isFog = ['mist', 'fog', 'haze', 'smoke', 'dust'].includes(key);

    els.sceneSun.style.opacity = (isClear || isClouds) ? '1' : '0';
    els.sceneCloud1.style.opacity = (isClouds || isRain || isStorm) ? '0.9' : (isClear ? '0.35' : '0');
    els.sceneCloud2.style.opacity = (isClouds || isRain || isStorm) ? '0.6' : '0';
    els.sceneRain.style.opacity = isRain || isStorm ? '1' : '0';
    els.sceneSnow.style.opacity = isSnow ? '1' : '0';
    els.sceneFog.style.opacity = isFog ? '1' : '0';
    els.sceneBolt.classList.toggle('flash', isStorm);
  }

  // ---- Render

  function renderCurrent(payload) {
    const { location, current } = payload;

    const metaParts = [location.state, location.country].filter(Boolean);
    els.locName.textContent = [location.name, metaParts[metaParts.length - 1]].filter(Boolean).join(', ');
    els.locMeta.textContent = metaParts.join(' · ') || '—';

    els.tempValue.textContent = current.temp;
    els.heroIcon.src = iconUrl(current.icon);
    els.heroIcon.alt = current.description;
    els.heroCondition.textContent = current.description;
    els.feelsLike.textContent = `${current.feels_like}${TEMP_SUFFIX}`;
    els.tempMax.textContent = `${current.temp_max}${TEMP_SUFFIX}`;
    els.tempMin.textContent = `${current.temp_min}${TEMP_SUFFIX}`;

    const info = conditionInfo(current.condition);
    els.explainerIcon.textContent = info.emoji;
    els.explainerTitle.textContent = info.title;
    els.explainerBody.textContent = info.body;

    els.statHumidity.textContent = `${current.humidity}%`;
    els.statWind.textContent = `${current.wind_speed} ${SPEED_SUFFIX}`;
    els.statPressure.textContent = `${current.pressure} hPa`;
    els.statVisibility.textContent = metersToVisibilityLabel(current.visibility);
    els.statClouds.textContent = `${current.clouds}%`;
    els.statSunrise.textContent = formatTime(current.sunrise);
    els.statSunset.textContent = formatTime(current.sunset);
    els.statWindDir.textContent = degToCompass(current.wind_deg);

    applyScene(current.condition);
  }

  function renderForecast(days) {
    els.forecastTrack.innerHTML = '';
    days.forEach((day) => {
      const card = document.createElement('article');
      card.className = 'forecast-card';
      card.innerHTML = `
        <span class="forecast-day">${day.day_name}</span>
        <span class="forecast-date">${day.day_short}</span>
        <img src="${iconUrl(day.icon)}" alt="${day.description}" loading="lazy" width="52" height="52">
        <span class="forecast-condition">${day.description}</span>
        <span class="forecast-temps"><span class="max">${day.temp_max}°</span><span class="min">${day.temp_min}°</span></span>
        <span class="forecast-extra">
          <span title="Chance of precipitation">💧 ${day.pop}%</span>
          <span title="Humidity">${day.humidity}%</span>
        </span>
      `;
      els.forecastTrack.appendChild(card);
    });
  }

  // ---- Charts

  let tempChart, rangeChart, precipChart;

  const CHART_TEXT_COLOR = '#b8c2d9';
  const CHART_GRID_COLOR = 'rgba(255,255,255,0.06)';

  function baseChartOptions(extra = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: CHART_TEXT_COLOR, font: { family: 'Inter', size: 11 }, boxWidth: 12 },
        },
        tooltip: {
          backgroundColor: '#141b2e',
          borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          titleColor: '#f3f6fc',
          bodyColor: '#b8c2d9',
          padding: 10,
          titleFont: { family: 'Inter', size: 12, weight: '600' },
          bodyFont: { family: 'JetBrains Mono', size: 11 },
        },
      },
      scales: {
        x: {
          ticks: { color: CHART_TEXT_COLOR, font: { family: 'JetBrains Mono', size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          grid: { color: CHART_GRID_COLOR },
        },
        y: {
          ticks: { color: CHART_TEXT_COLOR, font: { family: 'JetBrains Mono', size: 10 } },
          grid: { color: CHART_GRID_COLOR },
        },
      },
      ...extra,
    };
  }

  function renderCharts(series, days) {
    const tempCtx = document.getElementById('temp-chart');
    const rangeCtx = document.getElementById('range-chart');
    const precipCtx = document.getElementById('precip-chart');

    if (tempChart) tempChart.destroy();
    if (rangeChart) rangeChart.destroy();
    if (precipChart) precipChart.destroy();

    tempChart = new Chart(tempCtx, {
      type: 'line',
      data: {
        labels: series.map((s) => s.label),
        datasets: [
          {
            label: `Temperature (${TEMP_SUFFIX})`,
            data: series.map((s) => s.temp),
            borderColor: '#f5a623',
            backgroundColor: 'rgba(245,166,35,0.14)',
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2,
          },
          {
            label: `Feels like (${TEMP_SUFFIX})`,
            data: series.map((s) => s.feels_like),
            borderColor: '#5ac8fa',
            borderDash: [4, 4],
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 1.5,
          },
        ],
      },
      options: baseChartOptions({
        scales: {
          x: baseChartOptions().scales.x,
          y: { ...baseChartOptions().scales.y, ticks: { ...baseChartOptions().scales.y.ticks, callback: (v) => `${v}°` } },
        },
      }),
    });

    rangeChart = new Chart(rangeCtx, {
      type: 'bar',
      data: {
        labels: days.map((d) => d.day_short),
        datasets: [
          { label: `High (${TEMP_SUFFIX})`, data: days.map((d) => d.temp_max), backgroundColor: '#f5a623', borderRadius: 6, maxBarThickness: 22 },
          { label: `Low (${TEMP_SUFFIX})`, data: days.map((d) => d.temp_min), backgroundColor: 'rgba(90,200,250,0.65)', borderRadius: 6, maxBarThickness: 22 },
        ],
      },
      options: baseChartOptions({
        scales: {
          x: { ...baseChartOptions().scales.x, stacked: false },
          y: { ...baseChartOptions().scales.y, ticks: { ...baseChartOptions().scales.y.ticks, callback: (v) => `${v}°` } },
        },
      }),
    });

    precipChart = new Chart(precipCtx, {
      type: 'bar',
      data: {
        labels: days.map((d) => d.day_short),
        datasets: [
          { label: 'Chance of precipitation (%)', data: days.map((d) => d.pop), backgroundColor: '#4fd1c5', borderRadius: 6, maxBarThickness: 34 },
        ],
      },
      options: baseChartOptions({
        scales: {
          x: baseChartOptions().scales.x,
          y: { ...baseChartOptions().scales.y, min: 0, max: 100, ticks: { ...baseChartOptions().scales.y.ticks, callback: (v) => `${v}%` } },
        },
      }),
    });
  }

  function showChartsUnavailable() {
    const chartsGrid = document.querySelector('.charts-grid');
    if (!chartsGrid) return;
    chartsGrid.innerHTML = `
      <div class="chart-card chart-card--wide chart-card--unavailable">
        <p>Charts couldn't load right now (the charting library didn't come through). Everything else on the page is still live — try refreshing to bring the charts back.</p>
      </div>
    `;
  }

  // ---- Networking

  async function fetchWeather(city) {
    const response = await fetch(`/api/weather?city=${encodeURIComponent(city)}`);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('The server sent back something we could not read. Please try again.');
    }
    if (!response.ok || !payload.ok) {
      const err = new Error(payload.error || 'Something went wrong. Please try again.');
      err.status = response.status;
      throw err;
    }
    return payload.data;
  }

  async function search(city) {
    const trimmed = (city || '').trim();
    if (!trimmed) return;

    setSearching(true);
    els.loadingCity.textContent = trimmed;
    showState('loading');

    try {
      const data = await fetchWeather(trimmed);
      renderCurrent(data);
      renderForecast(data.forecast);
      showState('results');

      // Charts are an enhancement — if Chart.js failed to load from the CDN
      // (or a browser extension blocked it), don't take down the rest of an
      // otherwise-working dashboard.
      try {
        if (typeof Chart === 'undefined') {
          throw new Error('Chart.js did not load');
        }
        renderCharts(data.series, data.forecast);
      } catch (chartErr) {
        console.error('Chart rendering failed:', chartErr);
        showChartsUnavailable();
      }
    } catch (err) {
      els.errorTitle.textContent = err.status === 404 ? "We couldn't find that location." : 'Something went wrong.';
      els.errorMessage.textContent = err.message || 'Please try again.';
      showState('error');
    } finally {
      setSearching(false);
    }
  }

  // ---- Events

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    search(els.input.value);
  });

  els.quickPicks.addEventListener('click', (event) => {
    const btn = event.target.closest('.quick-pick');
    if (!btn) return;
    els.input.value = btn.dataset.city;
    search(btn.dataset.city);
  });

  els.retryBtn.addEventListener('click', () => {
    if (els.input.value.trim()) {
      search(els.input.value);
    } else {
      showState('empty');
    }
  });

  showState('empty');
})();
