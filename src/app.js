import {
  STATIONS, DEFAULT_STATION, RANGE, STALE_AFTER_HOURS, DATA_SOURCE,
  EVEN_BAND_HZ, DIR_BIN_DEG, DEFAULT_GAP, GAP_WARN_FRACTION,
} from './config.js';
import { loadStation } from './dataSource.js';
import { cdipSpectrum } from './mem.js';
import { prepareField, renderPolar, gapEnergyFraction } from './plot.js';
import { LEVEL_COLORS, formatEdge } from './colormap.js';

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
const select = $('station');
for (const s of STATIONS) select.add(new Option(`${s.name} (${s.id.replace(/p\d+$/, '')})`, s.id));
select.value = state.station;
select.addEventListener('change', () => { state.station = select.value; store.set('station', state.station); load(); });


$('refresh').addEventListener('click', () => load());
for (const [r, g, b] of LEVEL_COLORS) {
  const cell = document.createElement('span');
  cell.style.background = `rgb(${r},${g},${b})`;
  $('key').append(cell);
}
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
    const { rec: binned, spec } = cdipSpectrum(rec, { evenBandHz: EVEN_BAND_HZ, dirBinDeg: DIR_BIN_DEG });
    state.field = prepareField(spec, binned.frequency);
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
  const meta = STATIONS.find((s) => s.id === state.station);
  const gap = meta && 'gap' in meta ? meta.gap : DEFAULT_GAP;
  const { step, fLo, fHi } = renderPolar(canvas, { field: state.field, range: RANGE, dp: r?.dp, gap });
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
