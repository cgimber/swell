// Canvas polar plot of S(f,θ). North up, angle = direction waves come FROM,
// radius increases with frequency (long periods near the centre).
import { buildLut, rampPosition } from './colormap.js';
import { INNER_OFFSET, SCALE_MAX } from './config.js';

const LUT = buildLut();

/**
 * Turn the MEM output into a dense field ready for sampling: skipped bands
 * (null rows) are filled by linear interpolation from their valid neighbours.
 */
export function prepareField(spec, frequency) {
  const rows = spec.S;
  const valid = rows.map((r, i) => (r && Number.isFinite(frequency[i]) ? i : -1)).filter((i) => i >= 0);
  if (!valid.length) return null;
  const nDir = spec.dirs.length;
  const freqs = [], data = [];
  for (let i = valid[0]; i <= valid[valid.length - 1]; i++) {
    if (!Number.isFinite(frequency[i])) continue;
    let row = rows[i];
    if (!row) {
      const lo = valid.filter((j) => j < i).pop(), hi = valid.find((j) => j > i);
      const w = (frequency[i] - frequency[lo]) / (frequency[hi] - frequency[lo]);
      row = new Float64Array(nDir);
      for (let k = 0; k < nDir; k++) row[k] = rows[lo][k] * (1 - w) + rows[hi][k] * w;
    }
    freqs.push(frequency[i]);
    data.push(row);
  }
  return { freqs, data, step: spec.step, nDir };
}

/** Max of S over bands whose centre frequency lies in [fLo, fHi]. */
export function visibleMax(field, fLo, fHi) {
  let m = 0;
  field.freqs.forEach((f, i) => {
    if (f < fLo || f > fHi) return;
    for (const v of field.data[i]) if (v > m) m = v;
  });
  return m;
}

/** Bilinear sample at frequency f (Hz) and direction dir (deg, from). NaN if outside data. */
export function sampleField(field, f, dir) {
  const { freqs, data, step, nDir } = field;
  if (f < freqs[0] || f > freqs[freqs.length - 1]) return NaN;
  let i = 0, j = freqs.length - 1;
  while (j - i > 1) { const m = (i + j) >> 1; if (freqs[m] <= f) i = m; else j = m; }
  const wf = freqs[j] === freqs[i] ? 0 : (f - freqs[i]) / (freqs[j] - freqs[i]);
  const x = (((dir % 360) + 360) % 360) / step;
  const k0 = Math.floor(x) % nDir, k1 = (k0 + 1) % nDir, wd = x - Math.floor(x);
  const a = data[i][k0] * (1 - wd) + data[i][k1] * wd;
  const b = data[j][k0] * (1 - wd) + data[j][k1] * wd;
  return a * (1 - wf) + b * wf;
}

/**
 * Radius ↔ frequency mapping, as on CDIP's plot: linear in frequency, with
 * f = 0 at radius INNER_OFFSET·R and f = fMax at R.
 */
export function radialScale(fMax, R, inner = INNER_OFFSET) {
  const r0 = inner * R;
  return {
    fToR: (f) => r0 + (f / fMax) * (R - r0),
    rToF: (r) => ((r - r0) / (R - r0)) * fMax,
  };
}

/** Frequency limits for a range: data drawn between fLo and fHi, rim at fHi. */
export function rangeLimits(range) {
  return { fLo: 1 / range.maxPeriod, fHi: range.maxFreq };
}

function cssVar(el, name, fallback) {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/**
 * Draw the plot. Returns { vmax } for the colour bar.
 * opts: { field, range, dp }
 */
export function renderPolar(canvas, { field, range, dp }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssSize = canvas.clientWidth;
  const size = Math.round(cssSize * dpr);
  if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const fg = cssVar(canvas, '--plot-fg', '#222');
  const grid = cssVar(canvas, '--plot-grid', 'rgba(0,0,0,.25)');
  const bg = cssVar(canvas, '--plot-bg', '#fff');
  const accent = cssVar(canvas, '--accent', '#e0115f');

  const font = Math.max(11, Math.round(cssSize / 34)) * dpr;
  const margin = font * 2.2;
  const cx = size / 2, cy = size / 2, R = size / 2 - margin;
  const { fLo, fHi } = rangeLimits(range);
  const { fToR, rToF } = radialScale(fHi, R);
  const r0 = fToR(fLo); // empty centre: periods > maxPeriod

  // background disc
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

  // field
  const vmax = field ? visibleMax(field, fLo, SCALE_MAX === 'visible' ? fHi : Infinity) : 0;
  if (field && vmax > 0) {
    const img = ctx.createImageData(size, size);
    const px = img.data;
    for (let y = 0; y < size; y++) {
      const dy = y + 0.5 - cy;
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - cx;
        const r = Math.hypot(dx, dy);
        if (r > R || r < r0) continue;
        const dir = (Math.atan2(dx, -dy) * 180) / Math.PI; // clockwise from north
        const t = rampPosition(sampleField(field, rToF(r), dir) / vmax);
        if (!(t >= 0)) continue;
        const li = Math.round(t * 255) * 3;
        const o = (y * size + x) * 4;
        px[o] = LUT[li]; px[o + 1] = LUT[li + 1]; px[o + 2] = LUT[li + 2]; px[o + 3] = 255;
      }
    }
    const off = makeCanvas(size);
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.drawImage(off, 0, 0);
  }

  // grid: period rings
  ctx.lineWidth = dpr;
  ctx.strokeStyle = grid;
  ctx.fillStyle = fg;
  ctx.font = `${Math.round(font * 0.85)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelBearing = (135 * Math.PI) / 180; // SE: land side for San Diego buoys
  for (const p of range.rings) {
    const f = 1 / p;
    if (f <= fLo || f >= fHi) continue;
    const r = fToR(f);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    const lx = cx + r * Math.sin(labelBearing), ly = cy - r * Math.cos(labelBearing);
    haloText(ctx, `${p}s`, lx, ly, bg);
  }
  // inner (33 s) and outer boundary
  ctx.beginPath(); ctx.arc(cx, cy, r0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = fg;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

  // period range in the empty centre, as on CDIP's plot
  if (r0 > font * 2.2) {
    const loTxt = range.minPeriod;
    ctx.fillStyle = fg;
    ctx.font = `${Math.round(font * 0.8)}px system-ui, sans-serif`;
    ctx.fillText('Period range', cx, cy - font * 0.55);
    ctx.font = `600 ${Math.round(font * 0.95)}px system-ui, sans-serif`;
    ctx.fillText(`${loTxt}–${range.maxPeriod} s`, cx, cy + font * 0.6);
  }

  // spokes + compass labels every 30°
  ctx.strokeStyle = grid;
  ctx.font = `${font}px system-ui, sans-serif`;
  const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let a = 0; a < 360; a += 30) {
    const t = (a * Math.PI) / 180, s = Math.sin(t), c = -Math.cos(t);
    ctx.beginPath();
    ctx.moveTo(cx + r0 * s, cy + r0 * c);
    ctx.lineTo(cx + R * s, cy + R * c);
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.fillText(names[a] ?? `${a}°`, cx + (R + margin * 0.5) * s, cy + (R + margin * 0.5) * c);
  }

  // peak direction marker at the rim
  if (Number.isFinite(dp)) {
    const t = (dp * Math.PI) / 180, s = Math.sin(t), c = -Math.cos(t);
    const w = font * 0.45, tip = R - font * 0.2, base = R + font * 0.55;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(cx + tip * s, cy + tip * c);
    ctx.lineTo(cx + base * s - w * c, cy + base * c + w * s);
    ctx.lineTo(cx + base * s + w * c, cy + base * c - w * s);
    ctx.closePath(); ctx.fill();
  }
  return { vmax, fLo, fHi };
}

function haloText(ctx, text, x, y, halo) {
  ctx.save();
  ctx.lineWidth = 3 * (window.devicePixelRatio || 1);
  ctx.strokeStyle = halo;
  ctx.globalAlpha = 0.8;
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillText(text, x, y);
}

function makeCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}
