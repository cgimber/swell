// Jet-like ramp matching CDIP's polar-plot colour bar (sampled from their
// image): dark blue → blue → cyan → green → yellow → red → near-black,
// piecewise linear in RGB. Positions are fractions of the visible maximum;
// below the first stop the plot is transparent (CDIP: background colour).
import { TRANSPARENT_BELOW } from './config.js';

export const STOPS = [
  [TRANSPARENT_BELOW, [0, 0, 107]],
  [0.165, [0, 0, 255]],
  [0.33, [0, 250, 255]],
  [0.5, [0, 127, 0]],
  [0.665, [255, 250, 0]],
  [0.83, [255, 0, 0]],
  [1.0, [10, 0, 0]],
];

/** Lookup table of 256 RGB triplets over 0..1 (values below the first stop take its colour). */
export function buildLut(stops = STOPS) {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 1;
    while (j < stops.length - 1 && stops[j][0] < t) j++;
    const [t0, c0] = stops[j - 1], [t1, c1] = stops[j];
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = c0[k] + (c1[k] - c0[k]) * u;
  }
  return lut;
}

/** CSS gradient for the colour bar; the sub-threshold part is left transparent. */
export function cssGradient(stops = STOPS) {
  const pct = (t) => `${(t * 100).toFixed(1)}%`;
  return `linear-gradient(to right, transparent ${pct(stops[0][0])}, ${stops
    .map(([t, c]) => `rgb(${c.join(',')}) ${pct(t)}`).join(', ')})`;
}
