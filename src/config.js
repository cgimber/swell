// ── Data source ────────────────────────────────────────────────────────────
// "direct": the browser queries CDIP THREDDS (OPeNDAP ASCII) itself.
//           Works because THREDDS sends `Access-Control-Allow-Origin: *`.
// "static": the browser reads data/<station>.json from this site, written by
//           scripts/fetch-data.mjs (see .github/workflows/update-data.yml).
export const DATA_SOURCE = 'direct';

// ── Stations ───────────────────────────────────────────────────────────────
// `id` is the CDIP platform id used in the THREDDS file name (<id>_rt.nc).
// `lat`/`lon` are the deployment position (metaDeployLatitude/Longitude).
// `label` is the side of the dot its name goes on in the station map (default right).
export const STATIONS = [
  { id: '100p1', name: 'Torrey Pines Outer', lat: 32.93, lon: -117.392, label: 'left' },
  { id: '153p1', name: 'Del Mar Nearshore', lat: 32.95654, lon: -117.27956, label: 'top' },
  { id: '201p1', name: 'Scripps Nearshore', lat: 32.86785, lon: -117.26667, label: 'left' },
  { id: '220p1', name: 'Mission Bay West', lat: 32.749416, lon: -117.4985 },
  { id: '191p1', name: 'Point Loma South', lat: 32.516933, lon: -117.42522 },
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

// ── Plot range ──────────────────────────────────────────────────────────────
// CDIP's "Swell only" view (layout measured from their images): radius is
// linear in frequency, r = R·(INNER_OFFSET + (1 − INNER_OFFSET)·f/maxFreq), and
// nothing is drawn for periods longer than maxPeriod (33 s), which leaves an
// empty centre. maxFreq is CDIP's xmax_freq; `rings` are the periods CDIP
// labels. CDIP's other views, for reference:
//   High freq: minPeriod 1, maxFreq 0.74, rings [12, 6, 4, 2]
//   Normal:    minPeriod 3, maxFreq 1/3,  rings [20, 12, 8, 6, 4]
export const RANGE = { minPeriod: 8, maxPeriod: 33, maxFreq: 0.12, rings: [22, 16, 12, 10] };
export const INNER_OFFSET = 29 / 175; // radius of f = 0, as a fraction of the plot radius

// ── Spectrum processing (reproduces CDIP's polar plot exactly) ──────────────
// CDIP rebins the buoy's bands to even 0.01 Hz bands (energy-weighted moments),
// runs MEM, and averages into 5° direction bins (MEM_2dspectra.cdip "+even").
// Set EVEN_BAND_HZ = 0 and DIR_BIN_DEG = 1 for raw, full-resolution MEM.
export const EVEN_BAND_HZ = 0.01;
export const DIR_BIN_DEG = 5;
// Colour scale maximum: 'spectrum' = max over the whole spectrum (as on CDIP's
// plot), 'visible' = max within the 8–33 s range shown.
export const SCALE_MAX = 'spectrum';
// Colours: 10 discrete bands with round edges (see src/colormap.js). The scale
// maximum above sets the band width: the smallest round step with 10 bands
// covering it.
export const STALE_AFTER_HOURS = 2;
