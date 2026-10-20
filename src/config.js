// ── Data source ────────────────────────────────────────────────────────────
// "direct": the browser queries CDIP THREDDS (OPeNDAP ASCII) itself.
//           Works because THREDDS sends `Access-Control-Allow-Origin: *`.
// "static": the browser reads data/<station>.json from this site, written by
//           scripts/fetch-data.mjs (see .github/workflows/update-data.yml).
export const DATA_SOURCE = 'direct';

// ── Stations ───────────────────────────────────────────────────────────────
// `id` is the CDIP platform id used in the THREDDS file name (<id>_rt.nc).
export const STATIONS = [
  { id: '100p1', name: 'Torrey Pines Outer' },
  { id: '153p1', name: 'Del Mar Nearshore' },
  { id: '201p1', name: 'Scripps Nearshore' },
  { id: '220p1', name: 'Mission Bay West' },
  { id: '191p1', name: 'Point Loma South' },
];
export const DEFAULT_STATION = '100p1';

// Wedge of directions (from, clockwise from N, in degrees) left out of the
// plot, like the land-side gap on CDIP's map inset. Waves can't arrive from
// land at these buoys, so this frees the space for period labels. A station can
// override it with its own `gap` (or `gap: null` for a full circle). If more
// than GAP_WARN_FRACTION of the visible energy falls inside the gap, the page
// says so.
export const DEFAULT_GAP = [0, 135];
export const GAP_WARN_FRACTION = 0.05;

// ── Plot ranges ─────────────────────────────────────────────────────────────
// Same layout as CDIP's polar plot (measured from their images): radius is
// linear in frequency, r = R·(INNER_OFFSET + (1 − INNER_OFFSET)·f/maxFreq), and
// nothing is drawn for periods longer than maxPeriod (33 s), which leaves an
// empty centre. maxFreq matches CDIP's xmax_freq for each button; `rings` are
// the periods CDIP labels.
export const RANGES = {
  high:   { label: 'High freq',  minPeriod: 1, maxPeriod: 33, maxFreq: 0.74, rings: [12, 6, 4, 2] },
  normal: { label: 'Normal',     minPeriod: 3, maxPeriod: 33, maxFreq: 1 / 3, rings: [20, 12, 8, 6, 4] },
  swell:  { label: 'Swell only', minPeriod: 8, maxPeriod: 33, maxFreq: 0.12, rings: [22, 16, 12, 10] },
};
export const DEFAULT_RANGE = 'normal';
export const INNER_OFFSET = 29 / 175; // radius of f = 0, as a fraction of the plot radius

// ── Spectrum processing (reproduces CDIP's polar plot exactly) ──────────────
// CDIP rebins the buoy's bands to even 0.01 Hz bands (energy-weighted moments),
// runs MEM, and averages into 5° direction bins (MEM_2dspectra.cdip "+even").
// Set EVEN_BAND_HZ = 0 and DIR_BIN_DEG = 1 for raw, full-resolution MEM.
export const EVEN_BAND_HZ = 0.01;
export const DIR_BIN_DEG = 5;
// Colour scale maximum: 'spectrum' = max over the whole spectrum (CDIP: the
// same scale for every range button), 'visible' = max within the shown range.
export const SCALE_MAX = 'spectrum';
// Colour mapping, fitted to CDIP's plots (52 images, 26 stations; 99.7 % pixel agreement):
// a value v (as a fraction of the scale maximum) is drawn with the colour at
// COLOR_FLOOR + (1 − COLOR_FLOOR)·v along the ramp, so weak energy still shows
// as dark blue; values below TRANSPARENT_BELOW are not drawn.
export const COLOR_FLOOR = 0.09;
export const TRANSPARENT_BELOW = 0.022;
export const STALE_AFTER_HOURS = 2;
