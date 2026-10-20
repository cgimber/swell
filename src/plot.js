// Canvas polar plot of S(f,θ). North up, angle = direction waves come FROM,
// radius increases with frequency (long periods near the centre).
import { LEVEL_COLORS, FILL_RGB, levelStep, levelIndex } from './colormap.js';
import { INNER_OFFSET, SCALE_MAX } from './config.js';

const FONT = 'Inter, system-ui, sans-serif';

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

/** True if bearing `dir` lies inside the omitted wedge `gap` = [from, to] (clockwise from N). */
export function inGap(dir, gap) {
  if (!gap) return false;
  const width = (((gap[1] - gap[0]) % 360) + 360) % 360;
  return ((((dir - gap[0]) % 360) + 360) % 360) < width;
}

/** Fraction of the energy between fLo and fHi that comes from inside the gap. */
export function gapEnergyFraction(field, gap, fLo, fHi) {
  if (!field || !gap) return 0;
  let inside = 0, total = 0;
  field.freqs.forEach((f, i) => {
    if (f < fLo || f > fHi) return;
    field.data[i].forEach((v, k) => { total += v; if (inGap(k * field.step, gap)) inside += v; });
  });
  return total > 0 ? inside / total : 0;
}

function cssVar(el, name, fallback) {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/**
 * Draw the plot. Returns { vmax, step } for the colour key.
 * opts: { field, range, dp, gap } — gap: [fromDeg, toDeg] wedge to leave out, or null
 */
export function renderPolar(canvas, { field, range, dp, gap = null }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssSize = canvas.clientWidth;
  const size = Math.round(cssSize * dpr);
  if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const fg = cssVar(canvas, '--plot-fg', '#222');
  const bg = cssVar(canvas, '--plot-bg', '#fff');
  const accent = cssVar(canvas, '--accent', '#e0115f');

  const font = Math.max(11, Math.round(cssSize / 34)) * dpr;
  const margin = font * 2.2;
  const cx = size / 2, cy = size / 2, R = size / 2 - margin;
  const { fLo, fHi } = rangeLimits(range);
  const { fToR, rToF } = radialScale(fHi, R);
  const r0 = fToR(fLo); // empty centre: periods > maxPeriod

  // Sector covered by the plot: everything except the `gap` wedge, as on
  // CDIP's map inset. Canvas angles: bearing b → (b − 90)°.
  const ang = (b) => ((b - 90) * Math.PI) / 180;
  const [g0, g1] = gap ?? [0, 0];
  const sectorPath = (outer, inner) => {
    ctx.beginPath();
    if (gap) {
      ctx.arc(cx, cy, outer, ang(g1), ang(g0 + 360), false);
      ctx.arc(cx, cy, inner, ang(g0 + 360), ang(g1), true);
      ctx.closePath();
    } else {
      ctx.arc(cx, cy, outer, 0, Math.PI * 2);
      ctx.arc(cx, cy, inner, Math.PI * 2, 0, true);
    }
  };
  const arcPath = (r) => {
    ctx.beginPath();
    if (gap) ctx.arc(cx, cy, r, ang(g1), ang(g0 + 360), false);
    else ctx.arc(cx, cy, r, 0, Math.PI * 2);
  };

  // background fill: the colour of zero energy
  ctx.fillStyle = `rgb(${FILL_RGB.join(',')})`;
  sectorPath(R, r0);
  ctx.fill();

  // field
  const vmax = field ? visibleMax(field, fLo, SCALE_MAX === 'visible' ? fHi : Infinity) : 0;
  const step = levelStep(vmax);
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
        if (inGap(dir, gap)) continue;
        const level = levelIndex(sampleField(field, rToF(r), dir), step);
        if (level === 0) continue; // lowest band = background fill
        const [cr, cg, cb] = LEVEL_COLORS[level];
        const o = (y * size + x) * 4;
        px[o] = cr; px[o + 1] = cg; px[o + 2] = cb; px[o + 3] = 255;
      }
    }
    const off = makeCanvas(size);
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.save();
    sectorPath(R, r0);
    ctx.clip(); // keep anti-aliased sector edges clean
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  // grid: dotted rings; major axes every 45° (N, 315, W, 225, S) and fainter
  // minor axes every 15°, light so they read on the navy fill
  const spoke = (deg) => {
    const t = (deg * Math.PI) / 180, s = Math.sin(t), c = -Math.cos(t);
    ctx.beginPath();
    ctx.moveTo(cx + r0 * s, cy + r0 * c);
    ctx.lineTo(cx + R * s, cy + R * c);
    ctx.stroke();
  };
  const onEdge = (deg) => gap && (deg % 360 === g0 % 360 || deg % 360 === g1 % 360);
  ctx.lineWidth = dpr;
  ctx.setLineDash([dpr, 3 * dpr]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  for (let a = 0; a < 360; a += 15) if (a % 45 && !inGap(a, gap) && !onEdge(a)) spoke(a);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
  for (let a = 0; a < 360; a += 45) if (!inGap(a, gap) && !onEdge(a)) spoke(a);
  const rings = range.rings.filter((p) => 1 / p > fLo && 1 / p < fHi);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  for (const p of rings) { arcPath(fToR(1 / p)); ctx.stroke(); }
  ctx.setLineDash([]);

  // period labels outside the plot, along the clockwise edge of the gap
  ctx.fillStyle = fg;
  ctx.font = `500 ${Math.round(font * 0.85)}px ${FONT}`;
  ctx.textBaseline = 'middle';
  if (gap) {
    const t = (g1 * Math.PI) / 180, s = Math.sin(t), c = -Math.cos(t);
    const ox = -Math.cos(t), oy = -Math.sin(t); // perpendicular, pointing into the gap
    ctx.textAlign = ox >= 0 ? 'left' : 'right';
    for (const p of rings) {
      const r = fToR(1 / p);
      ctx.fillText(`${p} s`, cx + r * s + ox * font * 0.5, cy + r * c + oy * font * 0.5);
    }
  } else {
    ctx.textAlign = 'center';
    const t = (135 * Math.PI) / 180;
    for (const p of rings) {
      const r = fToR(1 / p);
      haloText(ctx, `${p} s`, cx + r * Math.sin(t), cy - r * Math.cos(t), bg);
    }
  }

  // labels on the major axes only (every 45°), none inside the gap
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.font = `500 ${font}px ${FONT}`;
  const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let a = 0; a < 360; a += 45) {
    if (gap && a !== g0 % 360 && (inGap(a, gap) || a === g1 % 360)) continue; // gap start (N) keeps its label
    const t = (a * Math.PI) / 180, s = Math.sin(t), c = -Math.cos(t);
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
  return { vmax, step, fLo, fHi };
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
