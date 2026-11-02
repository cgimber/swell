// Trend maths for the height and period cards: smoothing, direction, the next
// forecast turning point and sparkline geometry. Pure functions, no DOM.
// Series are [{ t (ms), hs (m), tp (s) }], observed or modelled; `key` picks
// 'hs' or 'tp'.
import { TREND } from './config.js';

const H = 3.6e6;

/** Rolling median of `key` over a centred window of `hours`: [{ t, v }]. */
export function smooth(series, key, hours) {
  const pts = series.filter((p) => Number.isFinite(p[key]));
  const half = (hours * H) / 2;
  let lo = 0, hi = 0;
  return pts.map((p) => {
    while (pts[lo].t < p.t - half) lo++;
    while (hi < pts.length && pts[hi].t <= p.t + half) hi++;
    return { t: p.t, v: median(pts.slice(lo, hi).map((q) => q[key])) };
  });
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Hs is noisy sample to sample; Tp jumps between frequency bins, so it needs a
// wider window before a change means anything.
const WINDOW = { hs: 3, tp: 5 };

/** Linear interpolation of a smoothed series at time t (NaN outside it). */
export function valueAt(s, t) {
  if (!s.length || t < s[0].t || t > s.at(-1).t) return NaN;
  let i = 1;
  while (i < s.length && s[i].t < t) i++;
  if (i >= s.length) return s.at(-1).v;
  const a = s[i - 1], b = s[i];
  return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}

/** Change needed to call a move up or down, around a value v. */
export function threshold(key, v, opts = TREND) {
  return key === 'hs' ? Math.max(opts.hsAbs, opts.hsRel * v) : opts.tpAbs;
}

/**
 * Direction over the next few hours: { dir: 'up'|'down'|'steady', delta, basis }.
 * Uses the forecast's own change from now to now + arrowHours, so the model's
 * offset from the buoy cancels. Without a forecast, falls back to the observed
 * change over the last arrowHours / 2.
 */
export function trendAt(obs, fc, now, key, opts = TREND) {
  let v0, v1, basis;
  const f = fc?.length ? smooth(fc, key, WINDOW[key]) : [];
  if (Number.isFinite(valueAt(f, now)) && Number.isFinite(valueAt(f, now + opts.arrowHours * H))) {
    v0 = valueAt(f, now); v1 = valueAt(f, now + opts.arrowHours * H); basis = 'forecast';
  } else {
    const o = smooth(obs ?? [], key, WINDOW[key]);
    if (o.length < 2) return null;
    v1 = o.at(-1).v;
    v0 = valueAt(o, o.at(-1).t - (opts.arrowHours / 2) * H);
    if (!Number.isFinite(v0)) v0 = o[0].v;
    basis = 'observed';
  }
  const delta = v1 - v0;
  const dir = Math.abs(delta) < threshold(key, v0, opts) ? 'steady' : delta > 0 ? 'up' : 'down';
  return { dir, delta, basis };
}

/**
 * Turning points in the forecast after now, in order, ignoring wiggles
 * smaller than the prominence (a zigzag filter). Each is { kind, t, value }:
 *   'peak' | 'low'       a turning point within the horizon,
 *   'rising' | 'falling' (last only) still heading that way at the end,
 *   'steady'             (only) no move bigger than the prominence.
 */
export function turningPoints(fc, now, key, opts = TREND) {
  const s = smooth(fc ?? [], key, WINDOW[key]).filter((p) => p.t >= now && p.t <= now + opts.aheadHours * H);
  if (!s.length) return [];
  const prom = key === 'hs' ? Math.max(opts.minProminence.hs, opts.hsRel * s[0].v) : opts.minProminence.tp;
  const out = [];
  let dir = 0, cand = s[0];
  for (const p of s) {
    if (dir === 0) {
      if (p.v - s[0].v >= prom) dir = 1;
      else if (s[0].v - p.v >= prom) dir = -1;
      if (dir) cand = p;
    } else if (dir * (p.v - cand.v) > 0) {
      cand = p;
    } else if (dir * (cand.v - p.v) >= prom) {
      out.push({ kind: dir > 0 ? 'peak' : 'low', t: cand.t, value: cand.v });
      dir = -dir; cand = p;
    }
  }
  if (!dir) return [{ kind: 'steady', t: s.at(-1).t, value: s[0].v }];
  // still moving at the horizon: report how far it gets, if that's a real move
  const last = out.at(-1)?.value ?? s[0].v;
  if (Math.abs(cand.v - last) >= prom) out.push({ kind: dir > 0 ? 'rising' : 'falling', t: cand.t, value: cand.v });
  return out;
}

/** The first of turningPoints, or null. */
export function nextTurningPoint(fc, now, key, opts = TREND) {
  return turningPoints(fc, now, key, opts)[0] ?? null;
}

/**
 * The first time the forecast moves a full threshold away from its value now:
 * { dir: 'up'|'down', t, value }, or null if it never does within the horizon.
 * Suits Tp, whose model values are steps rather than a smooth curve.
 */
export function nextChange(fc, now, key, opts = TREND) {
  const s = smooth(fc ?? [], key, WINDOW[key]).filter((p) => p.t <= now + opts.aheadHours * H);
  const v0 = valueAt(s, now);
  if (!Number.isFinite(v0)) return null;
  const th = threshold(key, v0, opts);
  for (const p of s) {
    if (p.t <= now || Math.abs(p.v - v0) < th) continue;
    return { dir: p.v > v0 ? 'up' : 'down', t: p.t, value: p.v };
  }
  return null;
}

/**
 * Sparkline geometry in a w × h box: observed (past) and forecast (from now)
 * paths on a shared scale, the x of now, local-midnight ticks (`days`) and
 * the stretch of each local day between them (`daySpans`: { t, x, w }, t the
 * span's start, x its centre, w its width; the first and last are partial
 * days cut off by the window). `floor` is the smallest y-range drawn, so small wiggles stay small;
 * `steps` draws the series as steps (for Tp). `marks` ([{ t, kind }]) are
 * placed on the drawn forecast line at their times, e.g. the turning points
 * the outlook text names.
 */
export function sparkGeometry(obs, fc, now, {
  w, h, key, pad = 2, floor = key === 'hs' ? 0.3 : 2, steps = key === 'tp', marks = [], opts = TREND,
} = {}) {
  const t0 = now - opts.pastHours * H, t1 = now + opts.aheadHours * H;
  const o = smooth(obs ?? [], key, key === 'hs' ? 1.5 : WINDOW[key]).filter((p) => p.t >= t0 && p.t <= now);
  const f = (fc ?? []).filter((p) => p.t >= now - H && p.t <= t1 && Number.isFinite(p[key])).map((p) => ({ t: p.t, v: p[key] }));
  const all = [...o, ...f].map((p) => p.v);
  if (!all.length) return null;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < floor) { const mid = (hi + lo) / 2; lo = mid - floor / 2; hi = mid + floor / 2; }
  const x = (t) => pad + ((t - t0) / (t1 - t0)) * (w - 2 * pad);
  const y = (v) => h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad);
  const path = (pts) => pts.map((p, i) => {
    const X = x(p.t).toFixed(1), Y = y(p.v).toFixed(1);
    if (i === 0) return `M${X} ${Y}`;
    return steps ? `H${X}V${Y}` : `L${X} ${Y}`;
  }).join('');
  const midnights = [];
  const d = new Date(t0);
  d.setHours(24, 0, 0, 0); // the first local midnight after t0
  for (; +d < t1; d.setDate(d.getDate() + 1)) midnights.push(+d);
  const edges = [t0, ...midnights, t1];
  const daySpans = edges.slice(0, -1).map((a, i) => {
    const xa = x(a), xb = x(edges[i + 1]);
    return { t: a, x: (xa + xb) / 2, w: xb - xa };
  });
  // a step line holds each value until the next sample, so read it that way
  const onLine = (t) => {
    if (!steps) return valueAt(f, t);
    let v = NaN;
    for (const p of f) { if (p.t > t) break; v = p.v; }
    return v;
  };
  return {
    obs: path(o), fc: path(f), nowX: x(now), days: midnights.map(x), daySpans, lo, hi,
    marks: marks.filter((m) => m.t >= t0 && m.t <= t1 && Number.isFinite(onLine(m.t)))
      .map((m) => ({ ...m, x: x(m.t), y: y(onLine(m.t)) })),
  };
}
