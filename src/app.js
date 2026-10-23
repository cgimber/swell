import {
  STATIONS, DEFAULT_STATION, RANGE, STALE_AFTER_HOURS, DATA_SOURCE,
  EVEN_BAND_HZ, DIR_BIN_DEG, DEFAULT_GAP, GAP_WARN_FRACTION,
} from './config.js';
import { loadStation } from './dataSource.js';
import { cdipSpectrum } from './mem.js';
import { prepareField, renderPolar, gapEnergyFraction } from './plot.js';
import { LEVEL_COLORS, formatEdge } from './colormap.js';
import { createStationMap } from './stationMap.js';

const $ = (id) => document.getElementById(id);
const canvas = $('plot');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const params = new URLSearchParams(location.search);
const state = {
  station: pick(params.get('station') || store.get('station'), STATIONS.map((s) => s.id), DEFAULT_STATION),
  rec: null,
  field: null,
  loadSeq: 0,
};
function pick(v, allowed, dflt) { return allowed.includes(v) ? v : dflt; }

// ── controls ───────────────────────────────────────────────────────────────
function selectStation(id) {
  state.station = id;
  stationMap?.setSelected(id);
  $('station-select').value = id;
  load();
}

// The map picker needs Leaflet from a CDN. If that didn't load, fall back to a
// plain dropdown rather than leaving the page without any way to switch.
let stationMap = null;
try {
  if (typeof L === 'undefined') throw new Error('Leaflet did not load');
  stationMap = createStationMap(canvas.parentElement, {
    stations: STATIONS, selected: state.station, onSelect: selectStation,
  });
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
$('source-mode').textContent = `Source: ${DATA_SOURCE === 'direct' ? 'CDIP THREDDS (live)' : 'cached JSON'}.`;

// ── loading ────────────────────────────────────────────────────────────────
// kind: '' (hidden) | 'loading' | 'error' (shows a Try again button)
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
    state.rec = null; state.field = null;
    clearSummary();
    draw();
  }
  setStatus(state.rec ? '' : 'Loading latest spectrum…', 'loading');
  try {
    const rec = await loadStation(state.station);
    if (seq !== state.loadSeq) return;
    const { rec: binned, spec } = cdipSpectrum(rec, { evenBandHz: EVEN_BAND_HZ, dirBinDeg: DIR_BIN_DEG });
    const field = prepareField(spec, binned.frequency);
    if (!field) throw new Error('No usable spectral bands in the latest record');
    state.rec = rec;
    state.field = field;
    // remember the station only once it has loaded, so a failing one isn't
    // reopened on every visit
    store.set('station', rec.station);
    setStatus('');
    updateSummary();
    draw();
  } catch (err) {
    if (seq !== state.loadSeq) return;
    console.error(err);
    setStatus(errorText(err, state.station), 'error');
  }
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
  for (const id of ['hs', 'tp', 'dp']) $(id).textContent = '—';
}

function updateSummary() {
  const r = state.rec;
  const meta = STATIONS.find((s) => s.id === r.station);
  $('station-name').textContent = stationTitle(meta?.name ?? r.name, r.station);
  const t = new Date(r.time);
  $('times').textContent = ageText(t);
  $('times').title = `${fmtLocal.format(t)} · ${fmtUtc.format(t)} UTC`; // full sample time on hover
  const ageH = (Date.now() - t) / 3.6e6;
  $('stale').hidden = ageH <= STALE_AFTER_HOURS;
  $('stale').textContent = `⚠ Data is ${ageText(t)} — the buoy may not be reporting.`;
  $('hs').innerHTML = Number.isFinite(r.hs)
    ? `${(r.hs * 3.28084).toFixed(1)}<span class="unit">ft</span><small>${r.hs.toFixed(2)} m</small>` : '—';
  $('tp').innerHTML = Number.isFinite(r.tp) ? `${r.tp.toFixed(1)}<span class="unit">s</span><small>${(1 / r.tp).toFixed(3)} Hz</small>` : '—';
  $('dp').innerHTML = Number.isFinite(r.dp) ? `${Math.round(r.dp)}°<small>${compass(r.dp)}</small>` : '—';
}

// "Torrey Pines Outer (100)": CDIP's station number, without the deployment suffix
function stationTitle(name, id) { return `${name} (${id.replace(/p\d+$/, '')})`; }

function ageText(t) {
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 48) return `${h} h ${m} min ago`;
  return `${Math.floor(h / 24)} days ago`;
}

function compass(deg) {
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return pts[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
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
  // key labels: the lower edge of each band, as on CDIP's keys
  $('key-labels').replaceChildren(...(r && step ? LEVEL_COLORS.map((_, i) => {
    const el = document.createElement('span');
    el.textContent = formatEdge(i * step);
    el.style.left = `${i * 10}%`;
    return el;
  }) : []));
}

let resizeRaf = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(draw);
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

clearSummary();
load();
