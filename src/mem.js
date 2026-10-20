// Maximum Entropy Method directional spreading (Lygre & Krogstad 1986),
// following CDIP's implementation.
//
// Convention: CDIP's a1/b1/a2/b2 are expressed in the nautical "coming from"
// frame, measured clockwise from true north, so that
//   mean direction (deg, from) = atan2(b1, a1)
// The returned D(θ) is indexed by that same θ: the direction waves come FROM.

/** Mean wave direction (nautical, deg from, 0..360) from first-order moments. */
export function meanDirection(a1, b1) {
  const d = (Math.atan2(b1, a1) * 180) / Math.PI;
  return (d + 360) % 360;
}

/**
 * Build the direction grid used everywhere: centres at 0, step, 2·step … (deg).
 */
export function directionGrid(stepDeg = 2) {
  const n = Math.round(360 / stepDeg);
  return Float64Array.from({ length: n }, (_, i) => i * stepDeg);
}

/**
 * MEM spreading function for one frequency band.
 * Returns Float64Array D (1/deg) normalised so sum(D)·step = 1, or null if the
 * band is unusable (fill/NaN or |c1| >= 1).
 */
export function memSpread(a1, b1, a2, b2, dirsDeg, stepDeg) {
  if (![a1, b1, a2, b2].every(Number.isFinite)) return null;
  // c1 = a1 + i b1, c2 = a2 + i b2
  const c1r = a1, c1i = b1, c2r = a2, c2i = b2;
  const m1 = c1r * c1r + c1i * c1i;
  if (m1 >= 1) return null;

  // φ1 = (c1 − c2·conj(c1)) / (1 − |c1|²)
  const t_r = c2r * c1r + c2i * c1i; // Re(c2·conj(c1))
  const t_i = c2i * c1r - c2r * c1i; // Im(c2·conj(c1))
  const p1r = (c1r - t_r) / (1 - m1);
  const p1i = (c1i - t_i) / (1 - m1);
  // φ2 = c2 − c1·φ1
  const p2r = c2r - (c1r * p1r - c1i * p1i);
  const p2i = c2i - (c1r * p1i + c1i * p1r);
  // numerator: 1 − φ1·conj(c1) − φ2·conj(c2)  (real part; imaginary ≈ 0)
  const num = 1 - (p1r * c1r + p1i * c1i) - (p2r * c2r + p2i * c2i);

  const D = new Float64Array(dirsDeg.length);
  let sum = 0;
  for (let k = 0; k < dirsDeg.length; k++) {
    const th = (dirsDeg[k] * Math.PI) / 180;
    const c = Math.cos(th), s = Math.sin(th);
    const c2 = Math.cos(2 * th), s2 = Math.sin(2 * th);
    // 1 − φ1·e^(−iθ) − φ2·e^(−2iθ)
    const zr = 1 - (p1r * c + p1i * s) - (p2r * c2 + p2i * s2);
    const zi = -(p1i * c - p1r * s) - (p2i * c2 - p2r * s2);
    const den = 2 * Math.PI * (zr * zr + zi * zi);
    const v = num / den;
    D[k] = Number.isFinite(v) && v > 0 ? v : 0;
    sum += D[k];
  }
  if (!(sum > 0)) return null;
  const norm = 1 / (sum * stepDeg);
  for (let k = 0; k < D.length; k++) D[k] *= norm;
  return D;
}

/**
 * Full directional spectrum S(f,θ) = E(f)·D(θ) in m²/Hz/deg.
 * rec: { frequency, energy, a1, b1, a2, b2 } arrays of equal length.
 * Returns { dirs, step, S: Array<Float64Array|null> } (null rows = skipped band).
 */
export function directionalSpectrum(rec, stepDeg = 2) {
  const dirs = directionGrid(stepDeg);
  const S = rec.frequency.map((_, i) => {
    const E = rec.energy[i];
    if (!Number.isFinite(E) || E < 0) return null;
    const D = memSpread(rec.a1[i], rec.b1[i], rec.a2[i], rec.b2[i], dirs, stepDeg);
    if (!D) return null;
    for (let k = 0; k < D.length; k++) D[k] *= E;
    return D;
  });
  return { dirs, step: stepDeg, S };
}

/**
 * Rebin a spectrum onto evenly spaced bands (CDIP's "even" option: 0.01 Hz
 * bands centred at 0.03, 0.04, … Hz). Each native band [f − bw/2, f + bw/2]
 * contributes in proportion to its overlap; energy is overlap-averaged and the
 * moments a1/b1/a2/b2 are energy-weighted. This reproduces CDIP's
 * MEM_2dspectra.cdip?<stn>+even output exactly.
 */
export function rebinEven(rec, { df = 0.01, f0 = 0.03 } = {}) {
  let top = 0;
  rec.frequency.forEach((f, i) => {
    if (Number.isFinite(f)) top = Math.max(top, f + (Number.isFinite(rec.bandwidth[i]) ? rec.bandwidth[i] / 2 : 0));
  });
  const nb = Math.floor((top - f0) / df + 0.5 + 1e-9);
  const keys = ['a1', 'b1', 'a2', 'b2'];
  const out = { ...rec, frequency: [], bandwidth: [], energy: [], a1: [], b1: [], a2: [], b2: [] };
  for (let k = 0; k < nb; k++) {
    const fc = f0 + k * df, lo = fc - df / 2, hi = fc + df / 2;
    let e = 0, w = 0;
    const m = { a1: 0, b1: 0, a2: 0, b2: 0 };
    rec.frequency.forEach((f, i) => {
      const bw = rec.bandwidth[i];
      const ov = Math.min(hi, f + bw / 2) - Math.max(lo, f - bw / 2);
      if (!(ov > 0)) return;
      const E = rec.energy[i];
      if (!Number.isFinite(E) || !keys.every((v) => Number.isFinite(rec[v][i]))) return;
      e += E * ov; w += ov;
      for (const v of keys) m[v] += E * rec[v][i] * ov;
    });
    out.frequency.push(+fc.toFixed(6));
    out.bandwidth.push(df);
    out.energy.push(w > 0 ? e / w : NaN);
    for (const v of keys) out[v].push(e > 0 ? m[v] / e : NaN);
  }
  return out;
}

/**
 * Average a 1° spectrum into wider direction bins centred on multiples of
 * `binDeg` (CDIP uses 5°: bins centred at 5, 10, … 360). Output keeps the
 * usual layout: index k ↔ direction k·binDeg.
 */
export function binDirections(spec, binDeg = 5) {
  if (spec.step !== 1) throw new Error('binDirections expects a 1° spectrum');
  if (binDeg === 1) return spec;
  const nb = Math.round(360 / binDeg), h = Math.floor(binDeg / 2);
  const S = spec.S.map((row) => {
    if (!row) return row;
    const out = new Float64Array(nb);
    for (let k = 0; k < nb; k++) {
      const c = k * binDeg;
      let s = 0;
      for (let d = -h; d <= h; d++) s += row[(c + d + 360) % 360];
      out[k] = s / (2 * h + 1);
    }
    return out;
  });
  return { dirs: directionGrid(binDeg), step: binDeg, S };
}

/**
 * The full CDIP polar-plot pipeline: optional rebin to even bands, MEM on a 1°
 * grid, then average into `dirBinDeg` bins.
 */
export function cdipSpectrum(rec, { evenBandHz = 0.01, dirBinDeg = 5 } = {}) {
  const r = evenBandHz ? rebinEven(rec, { df: evenBandHz }) : rec;
  return { rec: r, spec: binDirections(directionalSpectrum(r, 1), dirBinDeg) };
}

/** Index of the frequency band with maximum energy (ignores non-finite). */
export function peakIndex(energy) {
  let best = -1, bv = -Infinity;
  energy.forEach((e, i) => { if (Number.isFinite(e) && e > bv) { bv = e; best = i; } });
  return best;
}

/** Signed smallest difference a−b in degrees, in (−180, 180]. */
export function angleDiff(a, b) {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}
