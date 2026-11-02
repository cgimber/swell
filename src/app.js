import {
  STATIONS, DEFAULT_STATION, RANGE, STALE_AFTER_HOURS, DATA_SOURCE,
  EVEN_BAND_HZ, DIR_BIN_DEG, DEFAULT_GAP, GAP_WARN_FRACTION,
} from './config.js';
import { loadStation, loadForecast } from './dataSource.js';
import { cdipSpectrum } from './mem.js';
import { prepareField, renderPolar, gapEnergyFraction } from './plot.js';
import { LEVEL_COLORS, formatEdge } from './colormap.js';
import { createStationMap } from './stationMap.js';
import { trendAt, turningPoints, nextChange, sparkGeometry, smooth, valueAt } from './trend.js';

const $ = (id) => document.getElementById(id);
const canvas = $('plot');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// ?station= takes CDIP's station number (201), or a full id (201p1) as older links did
const fromParam = (v) => STATIONS.find((s) => v && (s.id === v || stationNumber(s.id) === v))?.id;
const state = {
  station: fromParam(new URLSearchParams(location.search).get('station'))
    ?? pick(store.get('station'), STATIONS.map((s) => s.id), DEFAULT_STATION),
  rec: null,
  field: null,
  fc: null,
  loadSeq: 0,
};
function pick(v, allowed, dflt) { return allowed.includes(v) ? v : dflt; }

// keep the address bar on the current station, so copying it shares that station
function syncUrl() {
  const url = new URL(location.href);
  url.searchParams.set('station', stationNumber(state.station));
  history.replaceState(null, '', url);
}

// ── controls ───────────────────────────────────────────────────────────────
function selectStation(id) {
  state.station = id;
  stationMap?.setSelected(id);
  $('station-select').value = id;
  syncUrl();
  load();
}

// The map picker needs Leaflet from a CDN. If that didn't load, fall back to a
// plain dropdown rather than leaving the page without any way to switch.
let stationMap = null;
try {
  if (typeof L === 'undefined') throw new Error('Leaflet did not load');
  stationMap = createStationMap(canvas.parentElement, {
    stations: STATIONS, selected: state.station, onSelect: selectStation,
    onOpen: () => { store.set('mapHintSeen', '1'); $('map-hint').hidden = true; },
  });
  $('map-hint').hidden = store.get('mapHintSeen') === '1';
} catch (err) {
  console.error('Station map unavailable:', err);
  canvas.parentElement.classList.add('no-map');
  $('station-fallback').hidden = false;
}
const select = $('station-select');
for (const s of STATIONS) select.add(new Option(stationTitle(s.name, s.id), s.id));
select.value = state.station;
select.addEventListener('change', () => selectStation(select.value));


for (const [r, g, b] of LEVEL_COLORS) {
  const cell = document.createElement('span');
  cell.style.background = `rgb(${r},${g},${b})`;
  $('key').append(cell);
}
function showSource(source) {
  $('source-mode').textContent = source === 'static'
    ? 'Source: a copy of CDIP THREDDS data, refreshed every 30 min (THREDDS was unreachable from here).'
    : 'Source: CDIP THREDDS (live).';
}
showSource(DATA_SOURCE === 'static' ? 'static' : 'direct');

// ── loading ────────────────────────────────────────────────────────────────
// kind: '' (hidden) | 'error' (shows a Try again button). While loading, the
// header is left blank (at its full height) and its values wipe in on arrival.
function setStatus(text, kind = '') {
  const el = $('status');
  el.hidden = !kind;
  el.className = `notice ${kind}`;
  $('status-text').textContent = text;
  $('retry').hidden = kind !== 'error';
}
$('retry').addEventListener('click', () => load());

function errorText(err, stationId) {
  const name = STATIONS.find((s) => s.id === stationId)?.name ?? stationId;
  const what = err?.status === 404
    ? `CDIP has no data for ${name} right now. The buoy may be offline, or CDIP may be updating its files.`
    : `Couldn't load ${name}: ${err?.name === 'DataError' ? err.message : 'something went wrong reading the data'}.`;
  const pick = stationMap ? 'tap the map to pick another station' : 'choose another station above';
  return `${what} Try again, or ${pick}.`;
}

async function load() {
  const seq = ++state.loadSeq;
  if (!state.rec || state.rec.station !== state.station) {
    state.rec = null; state.field = null; state.fc = null;
    clearSummary();
    draw();
  }
  setStatus('');
  loadTrend(seq, state.station); // in parallel; never holds up the plot
  try {
    const rec = await loadStation(state.station);
    if (seq !== state.loadSeq) return;
    const { rec: binned, spec } = cdipSpectrum(rec, { evenBandHz: EVEN_BAND_HZ, dirBinDeg: DIR_BIN_DEG });
    const field = prepareField(spec, binned.frequency);
    if (!field) throw new Error('No usable spectral bands in the latest record');
    const fresh = state.rec?.time !== rec.time || state.rec?.station !== rec.station;
    state.rec = rec;
    state.field = field;
    // remember the station only once it has loaded, so a failing one isn't
    // reopened on every visit
    store.set('station', rec.station);
    showSource(rec.source);
    setStatus('');
    updateSummary();
    if (fresh) wipe('times', 'hs', 'tp');
    draw();
  } catch (err) {
    if (seq !== state.loadSeq) return;
    console.error(err);
    setStatus(errorText(err, state.station), 'error');
  }
}

// The forecast only feeds the trend, so a failure just leaves it out (the
// trend falls back to the observed record).
async function loadTrend(seq, station) {
  let fc = null;
  try {
    fc = await loadForecast(station);
  } catch (err) {
    console.warn('Forecast unavailable:', err);
  }
  if (seq !== state.loadSeq) return;
  state.fc = fc;
  renderTrend();
}

// ── summary header ─────────────────────────────────────────────────────────
const fmtUtc = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const fmtLocal = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

function clearSummary() {
  const meta = STATIONS.find((s) => s.id === state.station);
  $('station-name').textContent = stationTitle(meta.name, state.station);
  $('times').textContent = '';
  $('stale').hidden = true;
  for (const id of ['hs', 'tp']) $(id).innerHTML = BLANK;
  for (const [key, param] of [['hs', 'waveHs'], ['tp', 'waveTp']]) {
    const a = $(`${key}-link`);
    a.href = `https://cdip.ucsd.edu/m/products/?stn=${state.station}&param=${param}`;
    a.title = `${key === 'hs' ? 'Wave height' : 'Peak period'} chart and forecast on CDIP`;
  }
  renderTrend();
  wipe('station-name');
}

// (re)start the header's wipe-in animation on these elements
function wipe(...ids) {
  for (const id of ids) {
    const el = $(id);
    el.classList.remove('wipe');
    void el.offsetWidth; // restart even if it's mid-wipe
    el.classList.add('wipe');
  }
}
document.addEventListener('animationend', (e) => {
  if (e.animationName === 'wipe') e.target.classList.remove('wipe');
});

// stats keep their line when empty so the cards don't change height:
// blank while loading, a dash when the buoy didn't report that value
const BLANK = '&nbsp;';
const NO_VALUE = '—';

function updateSummary() {
  const r = state.rec;
  const meta = STATIONS.find((s) => s.id === r.station);
  $('station-name').textContent = stationTitle(meta?.name ?? r.name, r.station);
  const t = new Date(r.time);
  $('times').textContent = ageText(t);
  $('times').title = `${fmtLocal.format(t)} · ${fmtUtc.format(t)} UTC`; // full sample time on hover
  const ageH = (Date.now() - t) / 3.6e6;
  $('stale').hidden = ageH <= STALE_AFTER_HOURS;
  $('stale').textContent = `⚠ Data is ${ageText(t)} — ${r.source === 'static'
    ? 'the buoy may not be reporting, or the cached copy is behind.'
    : 'the buoy may not be reporting.'}`;
  $('hs').innerHTML = Number.isFinite(r.hs)
    ? `${(r.hs * 3.28084).toFixed(1)}<span class="unit">ft</span>` : NO_VALUE;
  $('tp').innerHTML = Number.isFinite(r.tp) ? `${r.tp.toFixed(1)}<span class="unit">s</span>` : NO_VALUE;
  renderTrend();
}

// ── trend ──────────────────────────────────────────────────────────────────
// Under the height and period values: a sparkline of the last 24 h (buoy) and
// next 3 days (forecast), and a line or two saying what the forecast does next,
// each dotted on the sparkline (see README → Trend).
const GLYPH = { up: '↗', down: '↘', steady: '→' };
const WORD = { hs: { up: 'Building', down: 'Dropping', steady: 'Steady' }, tp: { up: 'Lengthening', down: 'Shortening', steady: 'Steady' } };
const FMT = { hs: (m) => `${(m * 3.28084).toFixed(1)} ft`, tp: (s) => `${s.toFixed(1)} s` };
const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
// compact local time for a narrow card: "Tue 2p"
function when(t) {
  const d = new Date(t), h = d.getHours();
  return `${fmtDay.format(d)} ${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;
}

// Peak period jumps to 5–7 s whenever local wind sea briefly holds the most
// energy. The trend follows swell, so it drops those, using the same 8 s floor
// as the plot.
const swellOnly = (series) => series.filter((p) => !(p.tp < RANGE.minPeriod));

// The next one or two things the forecast says will happen, as short lines:
// [{ text, t, dir }] (t and dir are missing for "steady" and level lines).
// Hs: turning points ("↘ 3.9 ft Tue 8p", then "↗ 5.3 ft Wed 2p").
// Tp: the model's groundswell period now, then its first full step away from
// that ("Groundswell 18.2 s", "↘ 16.7 s Mon 6a"), since model periods jump
// between bins. Naming it groundswell explains why it can differ from the
// buoy's Tp on the card, which wind sea can take over.
const STEADY = { text: '→ Steady 3 days' };
function outlookItems(key, fc, now) {
  if (!fc) return [];
  if (key === 'tp') {
    const c = nextChange(fc, now, 'tp');
    const level = valueAt(smooth(fc, 'tp', 5), now);
    return [
      ...(Number.isFinite(level) ? [{ text: `Groundswell ${FMT.tp(level)}` }] : []),
      c ? { text: `${GLYPH[c.dir]} ${FMT.tp(c.value)} ${when(c.t)}`, t: c.t, dir: c.dir } : STEADY,
    ];
  }
  return turningPoints(fc, now, 'hs').slice(0, 2).map((p) => {
    if (p.kind === 'steady') return STEADY;
    const dir = p.kind === 'peak' || p.kind === 'rising' ? 'up' : 'down';
    const by = p.kind === 'rising' || p.kind === 'falling' ? 'by ' : '';
    return { text: `${GLYPH[dir]} ${FMT.hs(p.value)} ${by}${when(p.t)}`, t: p.t, dir };
  });
}

// `marks`: outlook items to dot on the forecast line (filled = up, hollow = down).
// Under the chart, each day's abbreviation sits centred in its stretch between
// the midnight ticks; partial days at either end too narrow for it are left blank.
const DAY_AXIS = 18, DAY_LABEL_MIN_W = 24;
function sparkSvg(key, obs, fc, now, w, marks) {
  const h = 28;
  const g = sparkGeometry(obs, fc, now, { w, h, key, marks });
  if (!g) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h + DAY_AXIS}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = [
    ...g.days.map((x) => `<line class="day" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${h}"/>`),
    `<line class="now" x1="${g.nowX.toFixed(1)}" x2="${g.nowX.toFixed(1)}" y1="0" y2="${h}"/>`,
    `<path class="obs" d="${g.obs}"/>`,
    fc ? `<path class="fc" d="${g.fc}"/>` : '',
    ...g.marks.map((m) => `<circle class="mark ${m.dir}" cx="${m.x.toFixed(1)}" cy="${m.y.toFixed(1)}" r="2.5"/>`),
    ...g.daySpans.filter((s) => s.w >= DAY_LABEL_MIN_W).map((s) =>
      `<text class="day-label" x="${s.x.toFixed(1)}" y="${h + DAY_AXIS - 2}">${fmtDay.format(s.t)}</text>`),
  ].join('');
  return svg;
}

const line = (text, cls = 'line') => Object.assign(document.createElement('span'), { className: cls, textContent: text });

function renderTrend() {
  const r = state.rec;
  const fc = r && state.fc?.station === r.station ? state.fc.series : null;
  const now = Date.now();
  for (const key of ['hs', 'tp']) {
    const el = $(`${key}-trend`), out = $(`${key}-outlook`);
    const obs = key === 'tp' ? swellOnly(r?.history ?? []) : r?.history ?? [];
    const kfc = key === 'tp' && fc ? swellOnly(fc) : fc;
    const t = r && trendAt(obs, kfc, now, key);
    if (!t) { el.replaceChildren(); out.replaceChildren(); out.removeAttribute('aria-label'); continue; }
    const items = outlookItems(key, kfc, now);
    const outlook = items.map((i) => i.text);
    const marks = items.filter((i) => i.t);
    const svg = sparkSvg(key, obs, kfc, now, Math.max(40, Math.round(el.clientWidth || 80)), marks);
    // without a forecast, say which way the buoy's last few hours went
    const text = outlook.length ? outlook : [`${GLYPH[t.dir]} ${WORD[key][t.dir]}`];
    el.replaceChildren(...(svg ? [svg] : []));
    out.replaceChildren(...text.map((s) => line(s)));
    // one sentence for screen readers
    const name = key === 'hs' ? 'Wave height' : 'Peak period';
    out.setAttribute('aria-label', `${name} trend: ${WORD[key][t.dir].toLowerCase()}${t.basis === 'forecast' ? ' over the next few hours' : ' over the last few hours'}.${outlook.length ? ` Forecast: ${outlook.join(', then ').replace(/[↗↘→] /g, '')}.` : ''}`);
  }
}

// "Torrey Pines Outer (100)": CDIP's station number, without the deployment suffix
function stationTitle(name, id) { return `${name} (${stationNumber(id)})`; }
function stationNumber(id) { return id.replace(/p\d+$/, ''); }

function ageText(t) {
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 48) return `${h} h ${m} min ago`;
  return `${Math.floor(h / 24)} days ago`;
}

// ── drawing ────────────────────────────────────────────────────────────────
function draw() {
  const r = state.rec;
  const meta = STATIONS.find((s) => s.id === state.station);
  const gap = meta && 'gap' in meta ? meta.gap : DEFAULT_GAP;
  const { step, fLo, fHi, R, r0 } = renderPolar(canvas, { field: state.field, range: RANGE, dp: r?.dp, gap });
  stationMap?.layout({ R, r0 });
  const hidden = gapEnergyFraction(state.field, gap, fLo, fHi);
  const note = $('gap-note');
  note.hidden = !(hidden > GAP_WARN_FRACTION);
  if (gap) note.textContent = `${Math.round(hidden * 100)}% of the ${RANGE.minPeriod}–${RANGE.maxPeriod} s energy comes from ${gap[0]}–${gap[1]}°, which isn't drawn.`;
  // key labels: every band edge from 0 to the top of the scale. Tier 0 (min,
  // median, max) always shows; CSS reveals tier 1 (two more, keeping the
  // spacing near even) and then tier 2 (the rest) as the screen widens.
  const n = LEVEL_COLORS.length;
  $('key-labels').replaceChildren(...(r && step ? Array.from({ length: n + 1 }, (_, i) => {
    const el = document.createElement('span');
    el.textContent = formatEdge(i * step);
    el.style.left = `${(i / n) * 100}%`;
    el.dataset.tier = i % (n / 2) === 0 ? 0 : i === 2 || i === n - 2 ? 1 : 2;
    return el;
  }) : []));
}

let resizeRaf = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => { draw(); renderTrend(); });
}).observe(canvas);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
// the canvas only picks up Inter once it has loaded
document.fonts?.load('500 12px Inter').then(draw, () => {});

// keep the age fresh; reload when the tab returns or every 10 minutes
setInterval(() => { if (state.rec) updateSummary(); }, 60_000);
setInterval(() => { if (!document.hidden) load(); }, 10 * 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.rec && Date.now() - new Date(state.rec.time) > 35 * 60_000) load();
});

syncUrl();
clearSummary();
load();
