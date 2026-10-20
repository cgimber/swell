// Jet-like ramp matching CDIP's polar-plot colour bar (sampled from their
// image): dark blue → blue → cyan → green → yellow → red → near-black,
// piecewise linear in RGB. Positions are along the ramp (0–1). Values below the
// cutoff are drawn in the background fill, the ramp's first colour.
import { TRANSPARENT_BELOW, COLOR_FLOOR } from './config.js';

export const STOPS = [
  [21 / 310, [0, 0, 107]],
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

/** Background fill = colour of zero energy (the start of the ramp). */
export const FILL_RGB = STOPS[0][1];

/** Ramp position for a value given as a fraction of the scale max; NaN = not drawn. */
export function rampPosition(v) {
  return v >= TRANSPARENT_BELOW ? Math.min(1, COLOR_FLOOR + (1 - COLOR_FLOOR) * v) : NaN;
}

/** CSS gradient for the colour bar, drawn with the same mapping and fill as the plot. */
export function cssGradient(stops = STOPS) {
  const lut = buildLut(stops);
  const parts = [`rgb(${FILL_RGB.join(',')}) ${(TRANSPARENT_BELOW * 100).toFixed(1)}%`];
  for (let i = 0; i <= 40; i++) {
    const v = TRANSPARENT_BELOW + ((1 - TRANSPARENT_BELOW) * i) / 40;
    const li = Math.round(rampPosition(v) * 255) * 3;
    parts.push(`rgb(${lut[li]},${lut[li + 1]},${lut[li + 2]}) ${(v * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}
