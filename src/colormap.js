// Jet-like ramp: very pale → dark blue → cyan → green → yellow → red → near-black.
export const STOPS = [
  [0.00, [236, 241, 255]],
  [0.06, [20, 20, 140]],
  [0.22, [0, 80, 255]],
  [0.38, [0, 220, 255]],
  [0.52, [40, 230, 80]],
  [0.66, [255, 240, 0]],
  [0.82, [240, 30, 0]],
  [1.00, [50, 0, 0]],
];

/** Lookup table of 256 RGB triplets. */
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

export function cssGradient(stops = STOPS) {
  return `linear-gradient(to right, ${stops
    .map(([t, c]) => `rgb(${c.join(',')}) ${(t * 100).toFixed(0)}%`).join(', ')})`;
}
