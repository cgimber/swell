# swell

A static, phone-first page that shows the **latest directional wave spectrum**
from a [CDIP](https://cdip.ucsd.edu) buoy as a polar plot, like CDIP's own
"polar spectrum" product. There's no backend and no build step: plain
HTML/CSS/ES modules, no runtime dependencies.

- Angle is the direction waves come **from** (north up, labels every 30°).
- Radius is period: long periods sit near the centre, short periods at the rim.
  The layout matches CDIP's: radius is linear in frequency, and periods longer
  than 33 s are left blank, giving an empty centre.
- Colour is energy density S(f, θ) in m²/Hz/deg, using CDIP's colour ramp.
  The scale runs to the maximum of the whole spectrum, as on CDIP's plot, so it
  stays the same when you switch ranges.
- Toggles, as on CDIP: **High freq** (1–33 s, rim at 0.74 Hz),
  **Normal** (3–33 s) and **Swell only** (8–33 s, rim at 0.12 Hz).
- The header shows station, sample time (local and UTC), the data's age,
  Hs (ft and m), Tp and Dp. A pink marker on the rim shows Dp. Data older than
  2 hours gets a warning.

## How it works

```
index.html ─ src/app.js ─┬─ src/dataSource.js ─┬─ "direct": src/opendap.js → CDIP THREDDS
                         │                      └─ "static": data/<station>.json
                         ├─ src/mem.js      rebin → Maximum Entropy Method → S(f,θ)
                         └─ src/plot.js     canvas polar plot (+ src/colormap.js)
```

**Fetching (direct mode).** For a station such as `100p1`, the browser makes
three small, constrained OPeNDAP requests. It never downloads the netCDF file.

1. `…/100p1_rt.nc.dds?waveTime,waveFrequency` gets the array lengths N and F.
2. `…/100p1_rt.nc.ascii?waveTime[N-6:N-1],waveFlagPrimary[…],waveHs[…],waveTp[…],waveDp[…],waveFrequency[0:F-1],waveBandwidth[0:F-1],metaStationName`
   picks the newest record whose `waveFlagPrimary` is 1 (good).
3. `…/100p1_rt.nc.ascii?waveEnergyDensity[i][0:F-1],waveA1Value[i][…],waveB1Value[i][…],waveA2Value[i][…],waveB2Value[i][…]`
   fetches that one record's spectrum and Fourier moments.

`-999.99` fill values become `NaN`.

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
3. Scale colours to the maximum of the whole spectrum.
4. Map a value v (as a fraction of that maximum) to position
   0.09 + 0.91·v on the colour ramp, and leave values below 2.2 % blank. Weak
   energy therefore still shows as dark blue and the peak stands out.
5. Interpolate bilinearly between band centres and 5° bins for every pixel.

Steps 1 and 2 match CDIP's published matrices cell for cell. I checked 27
records, Datawell Mk3 (64 bands) and DWR4 (100 bands), and the tests pin two of
them. The colour-bar maximum equals CDIP's printed label on all 26 plots
checked. CDIP doesn't document the colour mapping in step 4, so I fitted it
against 52 CDIP plot images (26 stations, Swell and Normal ranges). It agrees on
99.7 % of pixels about whether a pixel is coloured, and within one colour step
where both are. I measured the plot geometry from the ring positions on CDIP's
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

URL parameters: `?station=201p1&range=swell` (`high` | `normal` | `swell`).
The last choices are also remembered in `localStorage`.

## Data source config

Everything goes through `src/dataSource.js`. You switch modes with one line in
`src/config.js`:

```js
export const DATA_SOURCE = 'direct'; // or 'static'
```

- **`direct`** (current default): the browser queries CDIP THREDDS itself.
  This works because THREDDS sends `Access-Control-Allow-Origin: *` on OPeNDAP
  responses and answers CORS preflights. I checked this on 2026-10-15.
- **`static`**: the browser reads `data/<station>.json` from the same site. Use
  this if CDIP ever drops CORS, or to take the per-visit load off THREDDS.
  `scripts/fetch-data.mjs` writes those files (`npm run fetch-data`). It
  rewrites a file only when the record changed, and logs the
  `atan2(b1,a1)` vs `Dp` check for each station.

To turn static mode on with automatic updates:

1. In `.github/workflows/update-data.yml`, uncomment the `schedule:` block
   (every 30 min). The workflow commits `data/*.json` only when something
   changed.
2. Set `DATA_SOURCE = 'static'` and commit.
3. Run the workflow once by hand: **Actions → update-data → Run workflow**.
4. Check that **Settings → Actions → General → Workflow permissions** allows
   read and write, so the job can push.

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
2. Add `{ id: '<id>', name: '<Name>' }` to `STATIONS` in `src/config.js`.
3. In static mode, the workflow picks it up on its next run because it reads
   the same list.

Current stations: 100p1 Torrey Pines Outer (default), 153p1 Del Mar
Nearshore, 201p1 Scripps Nearshore, 220p1 Mission Bay West and 191p1 Point
Loma South. All of them were verified against their THREDDS realtime files.

## Tuning

`src/config.js` also holds:

- `RANGES`: period limits, rim frequency (`maxFreq`) and labelled rings for
  each toggle. `INNER_OFFSET` sets the radius of f = 0.
- `EVEN_BAND_HZ` and `DIR_BIN_DEG`: CDIP's rebinning (0.01 Hz, 5°). Set them to
  `0` and `1` for raw, full-resolution MEM, which gives much sharper and higher
  peaks.
- `SCALE_MAX`: `'spectrum'` (CDIP) or `'visible'` (rescale to the shown range).
- `COLOR_FLOOR`, `TRANSPARENT_BELOW` and `STALE_AFTER_HOURS`.

Colours live in `src/colormap.js`.

## A note on MEM

MEM fits an AR(2) model to the first four Fourier moments. When r2 is well
below r1², it legitimately splits a single narrow peak into two lobes. Two
lobes in raw MEM can therefore be an artefact of the method rather than two
swells. CDIP's plots, which use the same method, show the same lobes.
