# swell

A static, phone-first page that shows the **latest directional wave spectrum**
from a [CDIP](https://cdip.ucsd.edu) buoy as a polar plot, like CDIP's own
"polar spectrum" product. There's no backend and no build step: plain
HTML/CSS/ES modules. The only runtime dependency is Leaflet (from a CDN) for
the station map.

- Angle is the direction waves come **from**, with north up.
  As on CDIP's map inset, the plot is a filled sector that leaves out the
  land-side wedge from 0° to 135°. The period labels sit in that gap, outside
  the plot. Major axes run every 30° (N, 330°, 300°, W, 240°, 210°, S, 150°)
  and are the only labelled directions. Fainter minor axes run every 15°. If
  more than 5 % of the energy comes from inside the wedge, a note says so.
- Radius is period: long periods sit near the centre, short periods at the rim.
  The layout matches CDIP's: radius is linear in frequency, and periods longer
  than 33 s are left blank, giving an empty centre.
- Colour is energy density S(f, θ) in m²/Hz/deg, drawn in 10 discrete bands
  of the [Turbo](https://research.google/blog/turbo-an-improved-rainbow-colormap-for-visualization/)
  colormap. Turbo steps more evenly than CDIP's jet-style colours. The bands have round edges (e.g. 0,
  0.04, … 0.36) chosen so they cover the maximum of the whole spectrum. That
  maximum is the same as on CDIP's plot. The lowest band, Turbo's darkest
  colour, is the background.
- Type is [Inter](https://rsms.me/inter/), loaded from Google Fonts, with
  tabular figures for numbers.
- The plot shows CDIP's **Swell only** view: 8–33 s, with the rim at 0.12 Hz.
- The header shows station, the data's age (hover for the sample time),
  wave height (Hs, in ft) and peak period (Tp). A pink marker on the plot's
  rim shows the peak direction (Dp). Data older than
  2 hours gets a warning.
- The height and period cards also show a **trend**: where Hs and Tp are
  heading, from the buoy's last 24 h and CDIP's forecast for the next 3 days
  (see [Trend](#trend)). Each card's **View source** link opens CDIP's chart
  for that station and value.
- The plot's empty centre shows a satellite map of the selected buoy. Tap it to
  open a map of all stations; tap a station to switch to it (× closes the map).
  Imagery is Esri World Imagery, via Leaflet. If Leaflet fails to load, a plain
  station dropdown appears instead.
- If THREDDS can't be reached (CDIP blocks some regions, Japan among them), the
  page falls back to a copy of the data on this site, refreshed every 30 min.
  See [Data source config](#data-source-config).
- If a station's data can't be loaded, a banner above the plot explains why and
  offers **Try again**. The station picker stays usable, so you can switch
  station. Each request times out after 20 s. A 404 or server error is retried
  once automatically, because THREDDS briefly returns 404 while it replaces a
  station's file. The page remembers a station only once its data has loaded,
  so reopening it never gets stuck on a failing station.

## How it works

```
index.html ─ src/app.js ─┬─ src/dataSource.js ─┬─ "direct": src/opendap.js → CDIP THREDDS
                         │   ("auto": direct,   └─ "static": data/<station>.json
                         │    then static)
                         ├─ src/mem.js      rebin → Maximum Entropy Method → S(f,θ)
                         └─ src/plot.js     canvas polar plot (+ src/colormap.js)
```

**Fetching (direct mode).** For a station such as `100p1`, the browser makes
three small, constrained OPeNDAP requests. It never downloads the netCDF file.

1. `…/100p1_rt.nc.dds?waveTime,waveFrequency` gets the array lengths N and F.
2. `…/100p1_rt.nc.ascii?waveTime[N-48:N-1],waveFlagPrimary[…],waveHs[…],waveTp[…],waveDp[…],waveFrequency[0:F-1],waveBandwidth[0:F-1],metaStationName`
   picks the newest record whose `waveFlagPrimary` is 1 (good).
3. `…/100p1_rt.nc.ascii?waveEnergyDensity[i][0:F-1],waveA1Value[i][…],waveB1Value[i][…],waveA2Value[i][…],waveB2Value[i][…]`
   fetches that one record's spectrum and Fourier moments.

`-999.99` fill values become `NaN`. Step 2 reads the last 48 records (24 h),
and the good-flagged Hs/Tp among them become the record's `history`.

The trend's forecast comes from a second file: CDIP's ECMWF-driven model run
at the buoy, `cdip/model/MOP_validation/BP100_ecmwf_fc.nc`. This is the
magenta "ECMWF-driven" line on CDIP's station chart. It is hourly and keeps
years of past runs, so the page reads only the tail:

1. `…/BP100_ecmwf_fc.nc.dds?waveTime` gets N.
2. `…/BP100_ecmwf_fc.nc.ascii?waveTime[N-200:N-1],waveHs[…],waveTp[…]` gets
   the last 200 hours. The page keeps now − 24 h to now + 72 h.

This loads alongside the record and never holds up the plot. If it fails,
the trend falls back to the buoy's own last few hours. CDIP's chart CSV
(`/m/dygraphs_plot/…`) would be simpler, but it sends no CORS header.

**MEM** (Lygre & Krogstad 1986, as CDIP uses). For each band,
`c1 = a1 + i·b1`, `c2 = a2 + i·b2`, then

```
φ1 = (c1 − c2·c̄1) / (1 − |c1|²)
φ2 = c2 − c1·φ1
D(θ) = (1 − φ1·c̄1 − φ2·c̄2) / (2π·|1 − φ1·e^(−iθ) − φ2·e^(−2iθ)|²)
```

D is normalised to integrate to 1 over 360° on a 1° grid, and
S(f, θ) = E(f)·D(θ). Bands with `|c1| ≥ 1` or NaN/fill values are skipped and
filled by interpolation when drawing.

**Matching CDIP's polar plot exactly.** CDIP publishes its 2-D spectrum through
[`MEM_2dspectra.cdip`](https://cdip.ucsd.edu/data_access/MEM_2dspectra.cdip?h).
Their polar plot is that output with the `even` option. The page reproduces it
in `cdipSpectrum()` (`src/mem.js`):

1. Rebin the buoy's bands onto even 0.01 Hz bands centred at 0.03, 0.04, … Hz.
   Each native band contributes by overlap. Energy is overlap-averaged, and
   a1/b1/a2/b2 are energy-weighted. This merges the narrow 0.005 Hz swell bands
   in pairs, which is the main reason CDIP's peaks are lower than raw MEM.
2. Run MEM on a 1° grid, then average into 5° direction bins.
3. Interpolate bilinearly between band centres and 5° bins for every pixel.
4. Scale colours to the maximum of the whole spectrum. CDIP's polar plot uses
   a continuous ramp. This page uses CDIP's discrete map-key style instead, with
   10 bands of round width covering that maximum.

Steps 1 and 2 match CDIP's published matrices cell for cell. I checked 27
records, Datawell Mk3 (64 bands) and DWR4 (100 bands), and the tests pin two of
them. The maximum in step 4 equals CDIP's printed colour-bar label on all 26
plots checked. I measured the plot geometry from the ring positions on CDIP's
images: radius = R·(0.166 + 0.834·f/f_max).

**Direction convention.** I checked this against real records: `atan2(b1, a1)`
at the peak band equals `waveDp`, the nautical direction waves come from, in
°True. No sign flip or rotation is needed. `tests/mem.test.js` asserts this on
fixtures captured from all five stations.

## Local development

You need Node 18 or later (only for tests) and any static file server.

```sh
npm start            # python3 -m http.server 8000 → http://localhost:8000
npm test             # node --test: parser, MEM, direction convention, plot helpers
```

URL parameter: `?station=201` (CDIP station number; `201p1` also works). The address bar
follows the selected station, so it can be copied to share a link.
The last choices are also remembered in `localStorage`.

## Data source config

Everything goes through `src/dataSource.js`. You switch modes with one line in
`src/config.js`:

```js
export const DATA_SOURCE = 'auto'; // or 'direct' or 'static'
```

- **`direct`**: the browser queries CDIP THREDDS itself. This works because
  THREDDS sends `Access-Control-Allow-Origin: *` on OPeNDAP responses and
  answers CORS preflights. I checked this on 2026-10-15.
- **`static`**: the browser reads `data/<station>.json` from the same site.
  `scripts/fetch-data.mjs` writes those files (`npm run fetch-data`). It
  rewrites a file only when the record changed, and logs the
  `atan2(b1,a1)` vs `Dp` check for each station.
- **`auto`** (current default): `direct` first, then `static` if THREDDS
  fails. If both fail, the page shows THREDDS's error.

**Why `auto`.** CDIP's AWS load balancer answers **403 Forbidden** to whole
regions. On 2026-11-02 every Japanese network tested was blocked, home and
mobile alike (SoftBank, NTT Docomo, TOKAI, Asahi Net), as were the UK,
Germany, India, Singapore and Brazil. The US, Canada, Mexico, Australia, Korea
and Taiwan got through. The 403 has no CORS header, so the browser reports a
network error. Before this change, those users saw "Couldn't reach CDIP's data
server" for every station. CDIP's own site (`cdip.ucsd.edu`) is blocked there
too, so the **View source** links won't open for them either. To check a
region yourself, use a [Globalping](https://globalping.io) HTTP probe. For
example, location `JP+eyeball-network` and path
`/thredds/dodsC/cdip/realtime/100p1_rt.nc.dds`.

When THREDDS fails with no HTTP status, as it does for a blocked region,
`auto` reads the cache first for the rest of the visit, so switching station
doesn't wait on a failing request. The footer says which source the current
station came from. The cache is at most about 30 min behind the buoy. The usual
2 h staleness warning applies to it too.

The `update-data` workflow (`.github/workflows/update-data.yml`) refreshes the
cache every 30 min and commits `data/*.json` only when something changed.
Its pushes use `GITHUB_TOKEN`, so they don't start the `test` workflow. To set
it up:

1. Check that **Settings → Actions → General → Workflow permissions** allows
   read and write, so the job can push.
2. Run the workflow once by hand: **Actions → update-data → Run workflow**.
   The schedule takes over from there. GitHub may delay scheduled runs by a
   few minutes.

## Deploying to GitHub Pages

The site is just the files at the repo root (`.nojekyll` turns off Jekyll).

1. Merge to `main`.
2. Go to **Settings → Pages → Build and deployment**, set Source to *Deploy
   from a branch*, and pick Branch `main`, folder `/ (root)`.
3. The site appears at `https://<user>.github.io/swell/`. All paths are
   relative, so it works under a sub-path.

The `test` workflow runs `npm test` on every push and PR.

## Adding a station

1. Find the station on CDIP and confirm its realtime file exists:
   `https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/<id>_rt.nc.dds`,
   where `<id>` looks like `045p1`. Directional buoys have
   `waveA1Value`…`waveB2Value`.
2. Add `{ id: '<id>', name: '<Name>', lat, lon }` to `STATIONS` in
   `src/config.js`, with the position from `metaDeployLatitude` and
   `metaDeployLongitude`. Add `label: 'left' | 'top' | 'bottom'` if its name
   overlaps another on the station map.
3. The `update-data` workflow picks it up on its next run because it reads
   the same list.

Current stations: 100p1 Torrey Pines Outer (default), 153p1 Del Mar
Nearshore, 201p1 Scripps Nearshore, 220p1 Mission Bay West and 191p1 Point
Loma South. All of them were verified against their THREDDS realtime files.

## Trend

`src/trend.js` holds the maths, with no DOM: a rolling-median smoother,
the direction over the next 6 h, the forecast's turning points (a zigzag
filter that ignores wiggles smaller than the prominence) and the sparkline
geometry. `TREND` in `src/config.js` sets the window and thresholds.

- **Direction** compares the forecast with itself, from now to now + 6 h, so
  the model's offset from the buoy cancels out. Hs counts as up or down past
  the larger of 8 % and 0.1 m. Tp needs 1.5 s.
- **Tp is quantized.** Buoy and model periods both jump between frequency
  bins (11.1, 15.4, 16.7, 18.2 s …). Tp is smoothed over 5 h, drawn as steps,
  and described by its first full step away from now, not by peaks.
- **Tp follows swell.** Peak period drops to 5–7 s whenever local wind sea
  briefly holds the most energy. The trend leaves out periods under 8 s, the
  same floor as the plot, so those flips don't take over the sparkline or the
  outlook. The card itself still shows the buoy's Tp.

Each card shows:

- **A sparkline.** The buoy's last 24 h is solid and the next 3 days of
  forecast is dashed, with local-midnight ticks and a "now" line. Each day's
  abbreviation sits centred under its stretch between the ticks; a partial
  day at either end that's too narrow for it is left unlabelled. It has no
  y-axis, and its y-range is at least 0.3 m (Hs) or 2 s (Tp), so small wiggles
  stay small.
- **An outlook.** The next forecast turning points as text, e.g. "↘ 3.9 ft
  Tue 12p", then "↗ 5.3 ft Wed 6a". For Tp, it shows the model's
  groundswell period now, then its first full step away from that, e.g.
  "Groundswell 18.2 s", then "↘ 16.7 s Mon 6a". Calling it groundswell
  explains why it can differ from the buoy's Tp on the card when wind sea is
  on top. Each line has a dot at that point on the sparkline: filled for a
  rise or peak, hollow for a drop or low. The groundswell line has no dot.
- **A fallback.** Without a forecast, a single line says which way the buoy's
  last few hours went, e.g. "↘ Dropping", and the sparkline shows the buoy
  record only.

`scripts/fetch-data.mjs` also writes
`data/<station>.forecast.json`, and the page trims it to the window.

## Tuning

`src/config.js` also holds:

- `RANGE`: period limits, rim frequency (`maxFreq`) and labelled rings. The
  comment beside it lists CDIP's other views. `INNER_OFFSET` sets the radius
  of f = 0.
- `EVEN_BAND_HZ` and `DIR_BIN_DEG`: CDIP's rebinning (0.01 Hz, 5°). Set them to
  `0` and `1` for raw, full-resolution MEM, which gives much sharper and higher
  peaks.
- `DEFAULT_GAP` (`[0, 135]`): the omitted wedge. A station in `STATIONS` can
  set its own `gap`, or `gap: null` for a full circle. `GAP_WARN_FRACTION`
  sets when the hidden-energy note appears.
- `SCALE_MAX`: `'spectrum'` (CDIP) or `'visible'` (rescale to 8–33 s).
- `STALE_AFTER_HOURS`.

The band colours and round-step rule live in `src/colormap.js`.

## A note on MEM

MEM fits an AR(2) model to the first four Fourier moments. When r2 is well
below r1², it legitimately splits a single narrow peak into two lobes. Two
lobes in raw MEM can therefore be an artefact of the method rather than two
swells. CDIP's plots, which use the same method, show the same lobes.
