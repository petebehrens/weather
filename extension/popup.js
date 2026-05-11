// Chrome extension popup — logic mirrors web version.
// Note: localStorage is sandboxed per extension; sizes/source set on the web don't
// propagate here automatically. Use exported config from web to update defaults.

const LOCATIONS = [
  { id: 'local',      name: 'Local',      full: 'Local',           isLocal: true },
  { id: 'louisville', name: 'Louisville', full: 'Louisville, CO',  lat: 39.9778, lon: -105.1319, default: true },
  { id: 'winterpark', name: 'WP',         full: 'Winter Park, CO', lat: 39.8919, lon: -105.7625 },
  { id: 'la',         name: 'LA',         full: 'Los Angeles, CA', lat: 34.0522, lon: -118.2437 },
  { id: 'kc',         name: 'KC',         full: 'Kansas City, MO', lat: 39.0997, lon: -94.5786 },
];

const STATE = {
  active: localStorage.getItem('wx-active') || 'louisville',
  source: localStorage.getItem('wx-source') || 'noaa',
};

const POINTS_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const LOCAL_COORDS_TTL_MS = 1000 * 60 * 10;

async function ensureCoords(loc) {
  if (!loc.isLocal) return { lat: loc.lat, lon: loc.lon };
  const cached = localStorage.getItem('wx-local-coords');
  if (cached) {
    try {
      const c = JSON.parse(cached);
      if (Date.now() - c.ts < LOCAL_COORDS_TTL_MS) return { lat: c.lat, lon: c.lon };
    } catch (e) {}
  }
  if (!navigator.geolocation) throw new Error('Geolocation not supported');
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const data = { lat: pos.coords.latitude, lon: pos.coords.longitude, ts: Date.now() };
        localStorage.setItem('wx-local-coords', JSON.stringify(data));
        resolve({ lat: data.lat, lon: data.lon });
      },
      (err) => reject(new Error(err.message || 'Location request failed')),
      { timeout: 12000, maximumAge: LOCAL_COORDS_TTL_MS, enableHighAccuracy: false }
    );
  });
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Forecast fetch failed (' + r.status + ')');
  return r.json();
}

async function fetchPoints(loc, coords) {
  const cacheKey = `wx-points-${loc.id}`;
  if (!loc.isLocal) {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.ts && Date.now() - parsed.ts < POINTS_TTL_MS) return parsed.data;
      } catch (e) {}
    }
  }
  const r = await fetch(`https://api.weather.gov/points/${coords.lat},${coords.lon}`);
  if (!r.ok) throw new Error('Points lookup failed (' + r.status + ')');
  const j = await r.json();
  const data = {
    forecast: j.properties.forecast,
    forecastHourly: j.properties.forecastHourly,
    timeZone: j.properties.timeZone,
    city: j.properties.relativeLocation?.properties?.city,
    state: j.properties.relativeLocation?.properties?.state,
  };
  if (!loc.isLocal) localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
  return data;
}

async function fetchNOAA(loc, coords) {
  const points = await fetchPoints(loc, coords);
  const [daily, hourly] = await Promise.all([
    fetchJSON(points.forecast),
    fetchJSON(points.forecastHourly),
  ]);
  return { daily, hourly, city: points.city, state: points.state };
}

function wmoToShortForecast(code, isDay) {
  if (code === 0) return isDay ? 'Sunny' : 'Clear';
  if (code === 1) return isDay ? 'Mostly Sunny' : 'Mostly Clear';
  if (code === 2) return 'Partly Cloudy';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code === 51 || code === 53 || code === 55) return 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing Drizzle';
  if (code === 61) return 'Light Rain';
  if (code === 63) return 'Rain';
  if (code === 65) return 'Heavy Rain';
  if (code === 66 || code === 67) return 'Freezing Rain';
  if (code === 71 || code === 73) return 'Snow';
  if (code === 75) return 'Heavy Snow';
  if (code === 77) return 'Snow';
  if (code === 80 || code === 81) return 'Rain Showers';
  if (code === 82) return 'Heavy Rain Showers';
  if (code === 85 || code === 86) return 'Snow Showers';
  if (code === 95) return 'Thunderstorms';
  if (code === 96 || code === 99) return 'Thunderstorms';
  return 'Unknown';
}

function degreesToCompass(deg) {
  if (deg == null) return null;
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return dirs[idx];
}

async function fetchOpenMeteo(loc, coords) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
    `&hourly=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation_probability,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,wind_speed_10m_max,wind_direction_10m_dominant,precipitation_probability_max` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=8` +
    `&models=ecmwf_ifs025`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Open-Meteo fetch failed (' + r.status + ')');
  const j = await r.json();

  const hourlyPeriods = j.hourly.time.map((t, i) => ({
    startTime: t,
    endTime: j.hourly.time[i + 1] || t,
    temperature: Math.round(j.hourly.temperature_2m[i]),
    windSpeed: `${Math.round(j.hourly.wind_speed_10m[i])} mph`,
    windDirection: degreesToCompass(j.hourly.wind_direction_10m[i]),
    shortForecast: wmoToShortForecast(j.hourly.weather_code[i], j.hourly.is_day[i] === 1),
    probabilityOfPrecipitation: { value: j.hourly.precipitation_probability[i] ?? 0 },
    isDaytime: j.hourly.is_day[i] === 1,
  }));

  const dailyPeriods = [];
  for (let i = 0; i < j.daily.time.length; i++) {
    const dateStr = j.daily.time[i];
    const code = j.daily.weather_code[i];
    const wspeed = `${Math.round(j.daily.wind_speed_10m_max[i])} mph`;
    const wdir = degreesToCompass(j.daily.wind_direction_10m_dominant[i]);
    const pop = j.daily.precipitation_probability_max[i] ?? 0;
    dailyPeriods.push({
      startTime: dateStr + 'T07:00:00',
      isDaytime: true,
      temperature: Math.round(j.daily.temperature_2m_max[i]),
      windSpeed: wspeed, windDirection: wdir,
      shortForecast: wmoToShortForecast(code, true),
      probabilityOfPrecipitation: { value: pop },
    });
    dailyPeriods.push({
      startTime: dateStr + 'T19:00:00',
      isDaytime: false,
      temperature: Math.round(j.daily.temperature_2m_min[i]),
      windSpeed: wspeed, windDirection: wdir,
      shortForecast: wmoToShortForecast(code, false),
      probabilityOfPrecipitation: { value: pop },
    });
  }

  return {
    daily: { properties: { periods: dailyPeriods } },
    hourly: { properties: { periods: hourlyPeriods } },
    city: null, state: null,
  };
}

function iconFor(shortForecast, isDay, precipPct) {
  const s = (shortForecast || '').toLowerCase();
  const chance = s.includes('chance');
  const expected = precipPct != null && precipPct >= 30;
  if (s.includes('thunder')) {
    if (expected) return '⛈️';
    return chance ? (isDay ? '⛅' : '☁️') : '⛈️';
  }
  if (s.includes('snow') && s.includes('rain')) return '🌨️';
  if (s.includes('snow') || s.includes('flurr')) {
    if (expected) return '❄️';
    return chance ? (isDay ? '⛅' : '☁️') : '❄️';
  }
  if (s.includes('sleet') || s.includes('ice') || s.includes('freezing')) return '🌧️';
  if (s.includes('rain') || s.includes('shower') || s.includes('drizzle')) {
    if (expected) return '🌧️';
    return chance ? (isDay ? '⛅' : '☁️') : '🌧️';
  }
  if (s.includes('fog') || s.includes('mist') || s.includes('haze') || s.includes('smoke')) return '🌫️';
  if (s.includes('partly')) return isDay ? '⛅' : '☁️';
  if (s.includes('mostly cloudy')) return '☁️';
  if (s.includes('cloudy') || s.includes('overcast')) return '☁️';
  if (s.includes('mostly sunny') || s.includes('mostly clear')) return isDay ? '🌤️' : '🌙';
  if (s.includes('sunny') || s.includes('clear') || s.includes('fair')) return isDay ? '☀️' : '🌙';
  if (s.includes('wind')) return '💨';
  if (s.includes('hot')) return '🌡️';
  return '·';
}

function classifyCondition(shortForecast, isDay, precipPct) {
  const s = (shortForecast || '').toLowerCase();
  const chance = s.includes('chance');
  const expected = precipPct != null && precipPct >= 30;
  if (s.includes('thunder')) {
    if (expected) return 'thunderstorm';
    return chance ? (isDay ? 'partly-cloudy-day' : 'partly-cloudy-night') : 'thunderstorm';
  }
  if (s.includes('snow') || s.includes('flurr') || s.includes('sleet') || s.includes('ice')) {
    if (expected) return 'snow';
    return chance ? (isDay ? 'partly-cloudy-day' : 'partly-cloudy-night') : 'snow';
  }
  if (s.includes('rain') || s.includes('shower') || s.includes('drizzle')) {
    if (expected) return 'rain';
    return chance ? (isDay ? 'partly-cloudy-day' : 'partly-cloudy-night') : 'rain';
  }
  if (s.includes('fog') || s.includes('mist') || s.includes('haze') || s.includes('smoke')) return 'fog';
  if (s.includes('partly')) return isDay ? 'partly-cloudy-day' : 'partly-cloudy-night';
  if (s.includes('cloudy') || s.includes('overcast') || s.includes('mostly cloudy')) return isDay ? 'cloudy-day' : 'cloudy-night';
  if (s.includes('mostly sunny')) return 'partly-cloudy-day';
  if (s.includes('mostly clear')) return 'partly-cloudy-night';
  return isDay ? 'clear-day' : 'clear-night';
}

const CONDITION_GRADIENT = {
  'clear-day':           'linear-gradient(180deg, #2d6cb6 0%, #5fa8e0 45%, #f0bb6e 100%)',
  'clear-night':         'linear-gradient(180deg, #06101e 0%, #14253f 50%, #243a5c 100%)',
  'partly-cloudy-day':   'linear-gradient(180deg, #3d6e9c 0%, #6e9bbe 50%, #a4bcd3 100%)',
  'partly-cloudy-night': 'linear-gradient(180deg, #0e1a2c 0%, #29405e 100%)',
  'cloudy-day':          'linear-gradient(180deg, #4f5c6e 0%, #6f7d92 60%, #8c97a8 100%)',
  'cloudy-night':        'linear-gradient(180deg, #1a2030 0%, #353e51 100%)',
  'rain':                'linear-gradient(180deg, #2c3e50 0%, #46637c 50%, #2c4a64 100%)',
  'thunderstorm':        'linear-gradient(180deg, #14182a 0%, #2c3148 50%, #423a55 100%)',
  'snow':                'linear-gradient(180deg, #4d647a 0%, #7d92a6 60%, #a8b8c6 100%)',
  'fog':                 'linear-gradient(180deg, #4a5563 0%, #6c7886 60%, #8a96a4 100%)',
};

const CONDITION_IMAGE = {
  'clear-day':           'https://source.unsplash.com/1200x900/?clear-sky,blue-sky',
  'clear-night':         'https://source.unsplash.com/1200x900/?starry-night,stars',
  'partly-cloudy-day':   'https://source.unsplash.com/1200x900/?sky,clouds',
  'partly-cloudy-night': 'https://source.unsplash.com/1200x900/?night-clouds',
  'cloudy-day':          'https://source.unsplash.com/1200x900/?overcast,clouds',
  'cloudy-night':        'https://source.unsplash.com/1200x900/?night-overcast',
  'rain':                'https://source.unsplash.com/1200x900/?rain',
  'thunderstorm':        'https://source.unsplash.com/1200x900/?thunderstorm,lightning',
  'snow':                'https://source.unsplash.com/1200x900/?snow,winter',
  'fog':                 'https://source.unsplash.com/1200x900/?fog,mist',
};

function applyBackground(condition) {
  const grad = CONDITION_GRADIENT[condition] || CONDITION_GRADIENT['cloudy-day'];
  document.body.style.backgroundImage = grad;
  const imgUrl = CONDITION_IMAGE[condition];
  if (!imgUrl) return;
  const test = new Image();
  test.onload = () => {
    document.body.style.backgroundImage =
      `linear-gradient(180deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.55) 100%), url("${imgUrl}")`;
  };
  test.onerror = () => {};
  test.src = imgUrl;
}

function parseWindSpeed(s) {
  if (!s) return null;
  const m = s.match(/(\d+)(?:\s*to\s*(\d+))?/);
  if (!m) return null;
  return m[2] ? Math.round((+m[1] + +m[2]) / 2) : +m[1];
}

const COMPASS_DEG = {
  N:0, NNE:22.5, NE:45, ENE:67.5, E:90, ESE:112.5, SE:135, SSE:157.5,
  S:180, SSW:202.5, SW:225, WSW:247.5, W:270, WNW:292.5, NW:315, NNW:337.5
};

function windStroke(speed) {
  if (speed == null || speed < 8) return 1.0;
  if (speed < 16) return 2.6;
  return 4.0;
}

function windArrow(direction, speed) {
  if (!direction) return '';
  const deg = COMPASS_DEG[direction.toUpperCase()];
  if (deg === undefined) return '';
  const rot = (deg + 90) % 360;
  const sw = windStroke(speed);
  return `<svg class="wind-arrow" viewBox="0 0 20 12" style="transform: rotate(${rot}deg);" preserveAspectRatio="xMidYMid meet">
    <path d="M3 6 H14 M11 3 L14 6 L11 9" stroke="currentColor" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function formatHour(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  if (h === 0) return '12a';
  if (h < 12) return h + 'a';
  if (h === 12) return '12p';
  return (h - 12) + 'p';
}

function formatDay(iso) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short' });
}

function findHighLow(periods) {
  let high = null, low = null;
  for (const p of periods) {
    if (p.isDaytime && high === null) high = p.temperature;
    else if (!p.isDaytime && low === null) low = p.temperature;
    if (high !== null && low !== null) break;
  }
  return { high, low };
}

function pairDaily(periods) {
  const out = [];
  let i = 0;
  while (i < periods.length && out.length < 8) {
    const a = periods[i];
    const b = periods[i + 1];
    if (a && a.isDaytime && b && !b.isDaytime) {
      out.push({
        date: a.startTime,
        high: a.temperature,
        low: b.temperature,
        shortForecast: a.shortForecast,
        windSpeed: parseWindSpeed(a.windSpeed),
        windDirection: a.windDirection,
        precip: Math.max(a.probabilityOfPrecipitation?.value ?? 0, b.probabilityOfPrecipitation?.value ?? 0),
      });
      i += 2;
    } else if (a && !a.isDaytime) {
      out.push({
        date: a.startTime,
        high: null,
        low: a.temperature,
        shortForecast: a.shortForecast,
        windSpeed: parseWindSpeed(a.windSpeed),
        windDirection: a.windDirection,
        precip: a.probabilityOfPrecipitation?.value ?? 0,
        nightOnly: true,
      });
      i += 1;
    } else {
      i += 1;
    }
  }
  return out;
}

function renderLocationPicker() {
  const picker = document.getElementById('locationPicker');
  picker.innerHTML = LOCATIONS.map(l =>
    `<button data-id="${l.id}" class="${l.id === STATE.active ? 'active' : ''}">${l.name}</button>`
  ).join('');
}

function renderError(msg) {
  document.getElementById('content').innerHTML = `<div class="err">${msg}</div>`;
}

function renderWeather(daily, hourly, meta) {
  const loc = LOCATIONS.find(l => l.id === STATE.active);

  const nowMs = Date.now();
  const validHourly = hourly.properties.periods.filter(p =>
    new Date(p.endTime || p.startTime).getTime() > nowMs
  );
  const cur = validHourly[0] || hourly.properties.periods[0];
  const upcoming = validHourly.slice(1, 7);

  const speed = parseWindSpeed(cur.windSpeed);
  const dir = cur.windDirection;
  const precip = cur.probabilityOfPrecipitation?.value ?? 0;

  const condition = classifyCondition(cur.shortForecast, cur.isDaytime, precip);
  applyBackground(condition);

  const dailyPairs = pairDaily(daily.properties.periods);
  const upcomingDays = dailyPairs.slice(1, 7);
  const { high, low } = findHighLow(daily.properties.periods);

  let html = '';

  if (loc.isLocal) {
    const label = (meta?.city && meta?.state) ? `Local · ${meta.city}, ${meta.state}` : 'Local';
    html += `<div class="location-label">${label}</div>`;
  } else if (!loc.default) {
    html += `<div class="location-label">${loc.full}</div>`;
  }

  html += `<section class="current">
    <div class="current-grid">
      <div class="current-left">
        <div class="temp-line">
          <span class="temp">${Math.round(cur.temperature)}°</span>
          <span class="cond-icon">${iconFor(cur.shortForecast, cur.isDaytime, precip)}</span>
        </div>
        ${high != null && low != null ? `<div class="hilo"><span class="hi">${high}°</span> / ${low}°</div>` : ''}
      </div>
      <div class="current-right">
        <div class="meta-line">${windArrow(dir, speed)} ${speed ?? '–'} mph</div>
        <div class="meta-line precip ${precip === 0 ? 'zero' : ''}">☔ ${precip}%</div>
      </div>
    </div>
  </section>`;

  html += `<div class="hourly">`;
  for (const h of upcoming) {
    const sp = parseWindSpeed(h.windSpeed);
    const pp = h.probabilityOfPrecipitation?.value ?? 0;
    html += `
      <div class="h-col">
        <div class="h-time">${formatHour(h.startTime)}</div>
        <div class="h-temp">${Math.round(h.temperature)}°</div>
        <div class="h-icon">${iconFor(h.shortForecast, h.isDaytime, pp)}</div>
        <div class="h-wind">${windArrow(h.windDirection, sp)} <span class="h-windspeed">${sp ?? '–'}</span></div>
        <div class="h-precip">${pp}%</div>
      </div>
    `;
  }
  html += `</div>`;

  html += `<div class="daily">`;
  upcomingDays.forEach((p) => {
    const dHigh = p.high != null ? `<span class="high">${p.high}°</span>` : '<span class="high">—</span>';
    const dLow = p.low != null ? `${p.low}°` : '—';
    html += `
      <div class="d-row">
        <span class="d-day">${formatDay(p.date)}</span>
        <span class="d-icon">${iconFor(p.shortForecast, true, p.precip)}</span>
        <span class="d-range">${dHigh} / ${dLow}</span>
        <span class="d-wind">${windArrow(p.windDirection, p.windSpeed)}<span class="d-windspeed">${p.windSpeed ?? '–'}</span></span>
        <span class="d-precip">${p.precip}%</span>
      </div>
    `;
  });
  html += `</div>`;

  document.getElementById('content').innerHTML = html;
}

let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  const refreshBtn = document.getElementById('refresh');
  refreshBtn.classList.add('spinning');

  let loc = LOCATIONS.find(l => l.id === STATE.active);
  if (!loc) {
    loc = LOCATIONS.find(l => l.default);
    STATE.active = loc.id;
    localStorage.setItem('wx-active', STATE.active);
    renderLocationPicker();
  }

  try {
    const coords = await ensureCoords(loc);
    const data = STATE.source === 'openmeteo'
      ? await fetchOpenMeteo(loc, coords)
      : await fetchNOAA(loc, coords);
    renderWeather(data.daily, data.hourly, { city: data.city, state: data.state });
    localStorage.setItem('wx-last-load', Date.now().toString());
  } catch (e) {
    console.error(e);
    if (loc.isLocal) {
      const def = LOCATIONS.find(l => l.default);
      STATE.active = def.id;
      localStorage.setItem('wx-active', STATE.active);
      renderLocationPicker();
      refreshBtn.classList.remove('spinning');
      loading = false;
      return load();
    }
    renderError('Could not load weather. ' + e.message);
  } finally {
    refreshBtn.classList.remove('spinning');
    loading = false;
  }
}

renderLocationPicker();
load();

document.getElementById('locationPicker').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.id === STATE.active) return;
  STATE.active = btn.dataset.id;
  localStorage.setItem('wx-active', STATE.active);
  renderLocationPicker();
  load();
});

document.getElementById('refresh').addEventListener('click', load);
