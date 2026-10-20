// Discrete colour levels using Google's Turbo colormap (exact values from
// matplotlib's 256-entry table, sampled at 10 evenly spaced points). Turbo
// steps more evenly than CDIP's jet-style key while keeping a blue → red read.
// The value range 0…top is cut into LEVEL_COLORS.length equal bands with round
// edges; band 0 is also the plot's background fill, so anything below the
// first edge blends into it.
export const LEVEL_COLORS = [
  '#30123b', '#4661d6', '#37a8fa', '#1ae4b6', '#71fe5f',
  '#c8ef34', '#faba39', '#f56918', '#ca2a04', '#7a0403',
].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

/** Background fill = colour of the lowest band. */
export const FILL_RGB = LEVEL_COLORS[0];

const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * Round band width so that `levels` bands cover 0…vmax:
 * the smallest step from 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^k with step·levels ≥ vmax.
 */
export function levelStep(vmax, levels = LEVEL_COLORS.length) {
  if (!(vmax > 0)) return 0;
  const raw = vmax / levels;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = NICE.find((n) => n * p >= raw * (1 - 1e-9));
  return m * p;
}

/** Band index for value v given the band width (clamped to the top band). */
export function levelIndex(v, step, levels = LEVEL_COLORS.length) {
  if (!(v >= 0) || !(step > 0)) return 0;
  return Math.min(levels - 1, Math.floor(v / step + 1e-9));
}

/** Format a band edge compactly: 0, 0.04, 0.012, 1.5 … */
export function formatEdge(v) {
  if (v === 0) return '0';
  return String(+v.toPrecision(3));
}
