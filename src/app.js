import {
  STATIONS, DEFAULT_STATION, RANGES, DEFAULT_RANGE, DIRECTION_STEP_DEG, STALE_AFTER_HOURS, DATA_SOURCE,
} from './config.js';
import { loadStation } from './dataSource.js';
import { directionalSpectrum } from './mem.js';
import { prepareField, renderPolar } from './plot.js';
import { cssGradient } from './colormap.js';

const $ = (id) => document.getElementById(id);
const canvas = $('plot');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const params = new URLSearchParams(location.search);
const state = {
  station: pick(params.get('station') || store.get('station'), STATIONS.map((s) => s.id), DEFAULT_STATION),
  range: pick(params.get('range') || store.get('range'), Object.keys(RANGES), DEFAULT_RANGE),
  rec: null,
  field: null,
  loadSeq: 0,
};
function pick(v, allowed, dflt) { return allowed.includes(v) ? v : dflt; }

// ── controls ───────────────────────────────────────────────────────────────
const select = $('station');
for (const s of STATIONS) select.add(new Option(`${s.name} (${s.id.replace(/p\d+$/, '')})`, s.id));
select.value = state.station;
select.addEventListener('change', () => { state.station = select.value; store.set('station', state.station); load(); });

const rangesEl = $('ranges');
for (const [key, r] of Object.entries(RANGES)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.dataset.range = key;
  b.textContent = r.label;
  b.addEventListener('click', () => { state.range = key; store.set('range', key); syncRangeButtons(); draw(); });
  rangesEl.append(b);
}
function syncRangeButtons() {
  for (const b of rangesEl.children) b.setAttribute('aria-checked', String(b.dataset.range === state.range));
}
syncRangeButtons();

$('refresh').addEventListener('click', () => load());
$('cbar').style.background = cssGradient();
$('source-mode').textContent = `Source: ${DATA_SOURCE === 'direct' ? 'CDIP THREDDS (live)' : 'cached JSON'}.`;

// ── loading ────────────────────────────────────────────────────────────────
function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

async function load() {
  const seq = ++state.loadSeq;
  $('refresh').classList.add('spinning');
  if (!state.rec || state.rec.station !== state.station) {
    state.rec = null; state.field = null;
    clearSummary();
    draw();
  }
  setStatus(state.rec ? '' : 'Loading latest spectrum…', 'loading');
  try {
    const rec = await loadStation(state.station);
    if (seq !== state.loadSeq) return;
    state.rec = rec;
    state.field = prepareField(directionalSpectrum(rec, DIRECTION_STEP_DEG), rec.frequency);
    if (!state.field) throw new Error('No usable spectral bands in the latest record');
    setStatus('');
    updateSummary();
    draw();
  } catch (err) {
    if (seq !== state.loadSeq) return;
    console.error(err);
    setStatus(`Couldn't load data: ${err.message}`, 'error');
  } finally {
    if (seq === state.loadSeq) $('refresh').classList.remove('spinning');
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
  $('station-name').textContent = `${meta.name} · ${state.station}`;
  $('times').textContent = '';
  $('stale').hidden = true;
  for (const id of ['hs', 'tp', 'dp']) $(id).textContent = '—';
}

function updateSummary() {
  const r = state.rec;
  const meta = STATIONS.find((s) => s.id === r.station);
  $('station-name').textContent = `${meta?.name ?? r.name} · ${r.station}`;
  const t = new Date(r.time);
  $('times').textContent = `${fmtLocal.format(t)} · ${fmtUtc.format(t)} UTC · ${ageText(t)}`;
  const ageH = (Date.now() - t) / 3.6e6;
  $('stale').hidden = ageH <= STALE_AFTER_HOURS;
  $('stale').textContent = `⚠ Data is ${ageText(t)} — the buoy may not be reporting.`;
  $('hs').innerHTML = Number.isFinite(r.hs)
    ? `${(r.hs * 3.28084).toFixed(1)} ft<small>${r.hs.toFixed(2)} m</small>` : '—';
  $('tp').innerHTML = Number.isFinite(r.tp) ? `${r.tp.toFixed(1)} s<small>${(1 / r.tp).toFixed(3)} Hz</small>` : '—';
  $('dp').innerHTML = Number.isFinite(r.dp) ? `${Math.round(r.dp)}°<small>${compass(r.dp)}</small>` : '—';
}

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
  const { vmax } = renderPolar(canvas, {
    field: state.field,
    range: RANGES[state.range],
    frequency: r?.frequency ?? [0.58],
    bandwidth: r?.bandwidth ?? [0.01],
    dp: r?.dp,
  });
  $('cmin').textContent = r ? '0' : '';
  $('cmid').textContent = r ? fmtVal(vmax / 2) : '';
  $('cmax').textContent = r ? fmtVal(vmax) : '';
}
function fmtVal(v) {
  if (!(v > 0)) return '0';
  return v >= 0.01 ? v.toPrecision(2) : v.toExponential(1);
}

let resizeRaf = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(draw);
}).observe(canvas);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);

// keep the age fresh; reload when the tab returns or every 10 minutes
setInterval(() => { if (state.rec) updateSummary(); }, 60_000);
setInterval(() => { if (!document.hidden) load(); }, 10 * 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.rec && Date.now() - new Date(state.rec.time) > 35 * 60_000) load();
});

clearSummary();
load();
