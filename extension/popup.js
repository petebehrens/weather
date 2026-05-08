// Chrome extensions (MV3) disallow inline scripts in popups, so the
// JS lives in this file. Logic is identical to the web version.

const LOCATIONS = [
  { id: 'louisville', name: 'Louisville',  full: 'Louisville, CO',  lat: 39.9778, lon: -105.1319, default: true },
  { id: 'winterpark', name: 'Winter Park', full: 'Winter Park, CO', lat: 39.8919, lon: -105.7625 },
  { id: 'la',         name: 'LA',          full: 'Los Angeles, CA', lat: 34.0522, lon: -118.2437 },
];

const STATE = {
  active: localStorage.getItem('wx-active') || 'louisville',
};

// ---------- API ----------
const POINTS_TTL_MS = 1000 * 60 * 60 * 24 * 30;

async function fetchPoints(loc) {
  const key = `wx-points-${loc.id}`;
  const cached = localStorage.getItem(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed.ts && Date.now() - parsed.ts < POINTS_TTL_MS) return parsed.data;
    } catch (e) {}
  }
  const r = await fetch(`https://api.weather.gov/points/${loc.lat},${loc.lon}`);
  if (!r.ok) throw new Error('Points lookup failed (' + r.status + ')');
  const j = await r.json();
  const data = {
    forecast: j.properties.forecast,
    forecastHourly: j.properties.forecastHourly,
    timeZone: j.properties.timeZone,
  };
  localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  return data;
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Forecast fetch failed (' + r.status + ')');
  return r.json();
}

// ---------- Mapping ----------
function iconFor(shortForecast, isDay) {
  const s = (shortForecast || '').toLowerCase();
  if (s.includes('thunder')) return '⛈';
  if (s.includes('snow') && s.includes('rain')) return '🌨';
  if (s.includes('snow') || s.includes('flurr')) return '❄';
  if (s.includes('sleet') || s.includes('ice') || s.includes('freezing')) return '🌧';
  if (s.includes('rain') || s.includes('shower') || s.includes('drizzle')) return '🌧';
  if (s.includes('fog') || s.includes('mist') || s.includes('haze') || s.includes('smoke')) return '🌫';
  if (s.includes('partly')) return isDay ? '⛅' : '☁';
  if (s.includes('mostly cloudy')) return '☁';
  if (s.includes('cloudy') || s.includes('overcast')) return '☁';
  if (s.includes('mostly sunny') || s.includes('mostly clear')) return isDay ? '🌤' : '🌙';
  if (s.includes('sunny') || s.includes('clear') || s.includes('fair')) return isDay ? '☀' : '🌙';
  if (s.includes('wind')) return '💨';
  if (s.includes('hot')) return '🌡';
  return '·';
}

function classifyCondition(shortForecast, isDay) {
  const s = (shortForecast || '').toLowerCase();
  if (s.includes('thunder')) return 'thunderstorm';
  if (s.includes('snow') || s.includes('flurr') || s.includes('sleet') || s.includes('ice')) return 'snow';
  if (s.includes('rain') || s.includes('shower') || s.includes('drizzle')) return 'rain';
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
  if (speed == null || speed < 8) return 1.2;
  if (speed < 16) return 1.9;
  return 2.7;
}

function windArrow(direction, speed, size) {
  if (!direction) return '';
  const deg = COMPASS_DEG[direction.toUpperCase()];
  if (deg === undefined) return '';
  const rot = (deg + 90) % 360;
  const w = size || 18;
  const h = Math.round(w * 0.55);
  const sw = windStroke(speed);
  return `<svg class="wind-arrow" viewBox="0 0 20 12" width="${w}" height="${h}" style="transform: rotate(${rot}deg);">
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

function formatDay(iso, idx) {
  if (idx === 0) return 'Today';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short' });
}

function pairDaily(periods) {
  const out = [];
  let i = 0;
  while (i < periods.length && out.length < 7) {
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

// ---------- Render ----------
function renderLocationPicker() {
  const picker = document.getElementById('locationPicker');
  picker.innerHTML = LOCATIONS.map(l =>
    `<button data-id="${l.id}" class="${l.id === STATE.active ? 'active' : ''}">${l.name}</button>`
  ).join('');
}

function renderError(msg) {
  document.getElementById('content').innerHTML = `<div class="err">${msg}</div>`;
}

function renderWeather(daily, hourly) {
  const cur = hourly.properties.periods[0];
  const upcoming = hourly.properties.periods.slice(0, 8);
  const loc = LOCATIONS.find(l => l.id === STATE.active);

  const speed = parseWindSpeed(cur.windSpeed);
  const dir = cur.windDirection;
  const precip = cur.probabilityOfPrecipitation?.value ?? 0;

  const condition = classifyCondition(cur.shortForecast, cur.isDaytime);
  applyBackground(condition);

  const dailyPairs = pairDaily(daily.properties.periods);

  let html = '';
  html += `<section class="current">`;
  if (!loc.default) {
    html += `<div class="location-label">${loc.full}</div>`;
  }
  html += `
    <div class="temp">${Math.round(cur.temperature)}°</div>
    <div class="condition"><span class="icon">${iconFor(cur.shortForecast, cur.isDaytime)}</span>${cur.shortForecast}</div>
    <div class="meta">
      <span class="item">${windArrow(dir, speed, 22)} ${speed ?? '–'} mph</span>
      <span class="item precip ${precip === 0 ? 'zero' : ''}">☔ ${precip}%</span>
    </div>
  </section>`;

  html += `<h2>Next 8 hours</h2><div class="hourly">`;
  for (const h of upcoming) {
    const sp = parseWindSpeed(h.windSpeed);
    const pp = h.probabilityOfPrecipitation?.value ?? 0;
    html += `
      <div class="h-col">
        <div class="h-time">${formatHour(h.startTime)}</div>
        <div class="h-temp">${Math.round(h.temperature)}°</div>
        <div class="h-icon">${iconFor(h.shortForecast, h.isDaytime)}</div>
        <div class="h-wind">${windArrow(h.windDirection, sp, 14)}</div>
        <div class="h-windspeed">${sp ?? '–'}</div>
        <div class="h-precip ${pp === 0 ? 'zero' : ''}">${pp}%</div>
      </div>
    `;
  }
  html += `</div>`;

  html += `<h2>Next 7 days</h2><div class="daily">`;
  dailyPairs.forEach((p, i) => {
    const high = p.high != null ? `<span class="high">${p.high}°</span>` : '<span class="high">—</span>';
    const low = p.low != null ? `${p.low}°` : '—';
    html += `
      <div class="d-row">
        <span class="d-day">${formatDay(p.date, i)}</span>
        <span class="d-icon">${iconFor(p.shortForecast, true)}</span>
        <span class="d-range">${high} / ${low}</span>
        <span class="d-wind">${windArrow(p.windDirection, p.windSpeed, 16)}<span class="d-windspeed">${p.windSpeed ?? '–'}</span></span>
        <span class="d-precip ${p.precip === 0 ? 'zero' : ''}">${p.precip > 0 ? p.precip + '%' : ''}</span>
      </div>
    `;
  });
  html += `</div>`;

  document.getElementById('content').innerHTML = html;
}

// ---------- Load ----------
let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  const refreshBtn = document.getElementById('refresh');
  refreshBtn.classList.add('spinning');

  const loc = LOCATIONS.find(l => l.id === STATE.active);
  try {
    const points = await fetchPoints(loc);
    const [daily, hourly] = await Promise.all([
      fetchJSON(points.forecast),
      fetchJSON(points.forecastHourly),
    ]);
    renderWeather(daily, hourly);
    localStorage.setItem('wx-last-load', Date.now().toString());
  } catch (e) {
    console.error(e);
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
