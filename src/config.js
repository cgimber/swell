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

// ── Plot ranges (periods in seconds) ───────────────────────────────────────
// Radius grows with frequency: maxPeriod (33 s) sits on the edge of an empty
// central disc and minPeriod on the outer rim. `rings` are labelled periods.
// High freq's 1 s floor is clamped to the highest measured band (~1.7 s).
export const RANGES = {
  high:   { label: 'High freq',  minPeriod: 1, maxPeriod: 33, rings: [22, 12, 8, 5, 3, 2] },
  normal: { label: 'Normal',     minPeriod: 3, maxPeriod: 33, rings: [22, 16, 12, 10, 8, 6, 4] },
  swell:  { label: 'Swell only', minPeriod: 8, maxPeriod: 33, rings: [22, 16, 12, 10] },
};
export const DEFAULT_RANGE = 'normal';
// 'log' spaces the period rings evenly enough to read swell detail on a phone;
// 'linear' is radius ∝ frequency.
export const RADIAL_SCALE = 'log';
export const CENTER_HOLE = 0.12; // empty centre radius, as a fraction of the plot radius

export const DIRECTION_STEP_DEG = 2;
// Values below this fraction of the visible maximum are drawn transparent.
export const TRANSPARENT_BELOW = 0.02;
export const STALE_AFTER_HOURS = 2;
