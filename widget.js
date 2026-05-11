// Weather widget for Scriptable (iOS) — Pete Behrens
// Medium widget: current temp + condition + wind + precip on top,
// 6-hour strip with wind direction/speed below.
// Tap → opens DEPLOY_URL.

// ====== CONFIG ======
// Replace this with your deployed page URL once GitHub Pages is live.
const DEPLOY_URL = 'https://YOURUSERNAME.github.io/REPONAME/';

// Default location (Louisville, CO).
const LOCATION = { name: 'Louisville', lat: 39.9778, lon: -105.1319 };

// How many forecast hours to show in the strip.
const HOURS_AHEAD = 6;

// Refresh cadence (minutes). iOS may extend this — it's a hint.
const REFRESH_MINUTES = 30;
// =====================

const COMPASS = {
  N:0, NNE:22.5, NE:45, ENE:67.5, E:90, ESE:112.5, SE:135, SSE:157.5,
  S:180, SSW:202.5, SW:225, WSW:247.5, W:270, WNW:292.5, NW:315, NNW:337.5
};

const GRADIENTS = {
  'clear-day':           [['#2d6cb6', 0], ['#5fa8e0', 0.5], ['#3a6082', 1]],
  'clear-night':         [['#06101e', 0], ['#14253f', 0.5], ['#243a5c', 1]],
  'partly-cloudy-day':   [['#3d6e9c', 0], ['#5a85aa', 0.5], ['#3e5773', 1]],
  'partly-cloudy-night': [['#0e1a2c', 0], ['#29405e', 1]],
  'cloudy-day':          [['#4f5c6e', 0], ['#6f7d92', 0.5], ['#4a5566', 1]],
  'cloudy-night':        [['#1a2030', 0], ['#353e51', 1]],
  'rain':                [['#2c3e50', 0], ['#46637c', 0.5], ['#2c4a64', 1]],
  'thunderstorm':        [['#14182a', 0], ['#2c3148', 0.5], ['#423a55', 1]],
  'snow':                [['#4d647a', 0], ['#7d92a6', 0.5], ['#5a6e84', 1]],
  'fog':                 [['#4a5563', 0], ['#6c7886', 0.5], ['#566270', 1]],
};

// ---------- API ----------
async function fetchWeather() {
  const ptsResp = await new Request(`https://api.weather.gov/points/${LOCATION.lat},${LOCATION.lon}`).loadJSON();
  const dailyURL = ptsResp.properties.forecast;
  const hourlyURL = ptsResp.properties.forecastHourly;
  const [daily, hourly] = await Promise.all([
    new Request(dailyURL).loadJSON(),
    new Request(hourlyURL).loadJSON(),
  ]);
  return { daily, hourly };
}

// ---------- Helpers ----------
function parseSpeed(s) {
  if (!s) return null;
  const m = s.match(/(\d+)(?:\s*to\s*(\d+))?/);
  if (!m) return null;
  return m[2] ? Math.round((+m[1] + +m[2]) / 2) : +m[1];
}

function iconFor(short, isDay, precipPct) {
  const s = (short || '').toLowerCase();
  const chance = s.includes('chance');
  const expected = precipPct != null && precipPct >= 30;
  if (s.includes('thunder')) {
    if (expected) return '⛈️';
    return chance ? (isDay ? '⛅' : '☁️') : '⛈️';
  }
  if (s.includes('snow') || s.includes('flurr')) {
    if (expected) return '❄️';
    return chance ? (isDay ? '⛅' : '☁️') : '❄️';
  }
  if (s.includes('rain') || s.includes('shower') || s.includes('drizzle')) {
    if (expected) return '🌧️';
    return chance ? (isDay ? '⛅' : '☁️') : '🌧️';
  }
  if (s.includes('fog') || s.includes('mist') || s.includes('haze')) return '🌫️';
  if (s.includes('partly')) return isDay ? '⛅' : '☁️';
  if (s.includes('cloudy') || s.includes('overcast')) return '☁️';
  if (s.includes('mostly sunny') || s.includes('mostly clear')) return isDay ? '🌤️' : '🌙';
  if (s.includes('sunny') || s.includes('clear') || s.includes('fair')) return isDay ? '☀️' : '🌙';
  if (s.includes('wind')) return '💨';
  return '·';
}

function classify(short, isDay) {
  const s = (short || '').toLowerCase();
  if (s.includes('thunder')) return 'thunderstorm';
  if (s.includes('snow') || s.includes('flurr')) return 'snow';
  if (s.includes('rain') || s.includes('shower') || s.includes('drizzle')) return 'rain';
  if (s.includes('fog') || s.includes('mist') || s.includes('haze')) return 'fog';
  if (s.includes('partly')) return isDay ? 'partly-cloudy-day' : 'partly-cloudy-night';
  if (s.includes('cloudy') || s.includes('overcast')) return isDay ? 'cloudy-day' : 'cloudy-night';
  return isDay ? 'clear-day' : 'clear-night';
}

function gradientFor(condition) {
  const stops = GRADIENTS[condition] || GRADIENTS['cloudy-day'];
  const grad = new LinearGradient();
  grad.colors = stops.map(s => new Color(s[0]));
  grad.locations = stops.map(s => s[1]);
  grad.startPoint = new Point(0.5, 0);
  grad.endPoint = new Point(0.5, 1);
  return grad;
}

function formatHour(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  if (h === 0) return '12a';
  if (h < 12) return h + 'a';
  if (h === 12) return '12p';
  return (h - 12) + 'p';
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

// ---------- Drawing ----------
// Native arrow points right (east). We rotate so the arrow points in the
// direction the wind is FLOWING (opposite of NWS's "from" direction).
// Stroke thickness: <8 mph thin, 8–15 medium, 16+ bold.
function windArrowImage(direction, speed, size) {
  if (!direction) return null;
  const deg = COMPASS[direction.toUpperCase()];
  if (deg === undefined) return null;

  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  let stroke = 1.6;
  if (speed != null && speed >= 16) stroke = 3.0;
  else if (speed != null && speed >= 8) stroke = 2.2;

  ctx.setStrokeColor(new Color('#ffffff'));
  ctx.setLineWidth(stroke);

  // canvas_angle = compass_from + 90  (see notes in web app)
  const ang = ((deg + 90) % 360) * Math.PI / 180;
  const cx = size / 2;
  const cy = size / 2;
  const half = size * 0.36;

  const sx = cx - Math.cos(ang) * half;
  const sy = cy - Math.sin(ang) * half;
  const ex = cx + Math.cos(ang) * half;
  const ey = cy + Math.sin(ang) * half;

  const path = new Path();
  path.move(new Point(sx, sy));
  path.addLine(new Point(ex, ey));

  // Chevron at end
  const headLen = size * 0.22;
  const headSpread = Math.PI / 6;
  const h1x = ex - Math.cos(ang - headSpread) * headLen;
  const h1y = ey - Math.sin(ang - headSpread) * headLen;
  const h2x = ex - Math.cos(ang + headSpread) * headLen;
  const h2y = ey - Math.sin(ang + headSpread) * headLen;
  path.move(new Point(h1x, h1y));
  path.addLine(new Point(ex, ey));
  path.addLine(new Point(h2x, h2y));

  ctx.addPath(path);
  ctx.strokePath();
  return ctx.getImage();
}

// ---------- Build widget ----------
async function buildWidget() {
  const w = new ListWidget();
  w.url = DEPLOY_URL;
  w.setPadding(10, 14, 10, 14);

  let data;
  try {
    data = await fetchWeather();
  } catch (e) {
    w.backgroundColor = new Color('#1a2030');
    const t = w.addText('Weather unavailable');
    t.textColor = Color.white();
    t.font = Font.systemFont(14);
    return w;
  }

  // Filter out past hourly periods (NWS sometimes lags an hour or two).
  const nowMs = Date.now();
  const validHourly = data.hourly.properties.periods.filter(p =>
    new Date(p.endTime || p.startTime).getTime() > nowMs
  );
  const cur = validHourly[0] || data.hourly.properties.periods[0];
  const condition = classify(cur.shortForecast, cur.isDaytime);
  w.backgroundGradient = gradientFor(condition);

  const speed = parseSpeed(cur.windSpeed);
  const dir = cur.windDirection;
  const precip = cur.probabilityOfPrecipitation?.value ?? 0;
  const { high, low } = findHighLow(data.daily.properties.periods);

  // ============ Top row ============
  const top = w.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();

  // Left: temp + condition + H/L
  const left = top.addStack();
  left.layoutVertically();

  // temp + condition icon inline
  const tempLine = left.addStack();
  tempLine.layoutHorizontally();
  tempLine.centerAlignContent();
  const tempT = tempLine.addText(`${Math.round(cur.temperature)}°`);
  tempT.font = Font.regularSystemFont(40);
  tempT.textColor = Color.white();
  tempT.lineLimit = 1;
  tempLine.addSpacer(6);
  const condIcon = tempLine.addText(iconFor(cur.shortForecast, cur.isDaytime, precip));
  condIcon.font = Font.systemFont(28);

  if (high != null && low != null) {
    const hl = left.addText(`${high}° / ${low}°`);
    hl.font = Font.regularSystemFont(13);
    hl.textColor = new Color('#ffffff', 0.78);
  }

  top.addSpacer();

  // Right: wind + precip
  const right = top.addStack();
  right.layoutVertically();

  const windRow = right.addStack();
  windRow.layoutHorizontally();
  windRow.centerAlignContent();
  windRow.addSpacer();
  const arrowImg = windArrowImage(dir, speed, 20);
  if (arrowImg) {
    const ai = windRow.addImage(arrowImg);
    ai.imageSize = new Size(20, 20);
  }
  windRow.addSpacer(4);
  const windT = windRow.addText(`${speed ?? '–'} mph`);
  windT.font = Font.semiboldSystemFont(13);
  windT.textColor = Color.white();

  right.addSpacer(2);

  const precipRow = right.addStack();
  precipRow.layoutHorizontally();
  precipRow.addSpacer();
  const precipT = precipRow.addText(`☔ ${precip}%`);
  precipT.font = Font.systemFont(11);
  precipT.textColor = precip > 0 ? new Color('#87cefa') : new Color('#ffffff', 0.55);

  // ============ Bottom strip ============
  w.addSpacer(8);

  const bottom = w.addStack();
  bottom.layoutHorizontally();

  const hours = validHourly.slice(1, 1 + HOURS_AHEAD);

  for (let i = 0; i < hours.length; i++) {
    const h = hours[i];
    const sp = parseSpeed(h.windSpeed);
    const pp = h.probabilityOfPrecipitation?.value ?? 0;

    const col = bottom.addStack();
    col.layoutVertically();
    col.centerAlignContent();

    const time = col.addText(formatHour(h.startTime));
    time.font = Font.systemFont(11);
    time.textColor = new Color('#ffffff', 0.7);
    time.centerAlignText();

    const t = col.addText(`${Math.round(h.temperature)}°`);
    t.font = Font.semiboldSystemFont(14);
    t.textColor = Color.white();
    t.centerAlignText();

    const ic = col.addText(iconFor(h.shortForecast, h.isDaytime, pp));
    ic.font = Font.systemFont(15);
    ic.centerAlignText();

    const arrow = windArrowImage(h.windDirection, sp, 16);
    if (arrow) {
      const ai = col.addImage(arrow);
      ai.imageSize = new Size(16, 16);
      ai.centerAlignImage();
    } else {
      const blank = col.addText(' ');
      blank.font = Font.systemFont(13);
    }

    const sw = col.addText(sp != null ? `${sp}` : '–');
    sw.font = Font.systemFont(11);
    sw.textColor = new Color('#ffffff', 0.7);
    sw.centerAlignText();

    if (i < hours.length - 1) bottom.addSpacer();
  }

  w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);
  return w;
}

// ---------- Run ----------
const widget = await buildWidget();
if (!config.runsInWidget) {
  await widget.presentMedium();
}
Script.setWidget(widget);
Script.complete();
