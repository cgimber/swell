// Minimal OPeNDAP (DAP2) client for CDIP THREDDS realtime files.
// Uses only constrained .dds and .ascii requests — never downloads the file.
// Shared by the browser (direct mode) and the Node data script (static mode).

export const THREDDS_BASE = 'https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime';
export const FILL_VALUE = -999.99;
const FLAG_FILL = -127;
const FLAG_GOOD = 1;

/** Dimension sizes from a DDS, e.g. { waveTime: 8175, waveFrequency: 64 }. */
export function parseDdsDims(dds) {
  const dims = {};
  for (const m of dds.matchAll(/\[(\w+) = (\d+)\]/g)) {
    dims[m[1]] = Number(m[2]);
  }
  return dims;
}

/**
 * Parse an OPeNDAP .ascii response into { name: { dims:[...], values:[...] } }.
 * Grid arrays ("waveA1Value.waveA1Value") are stored under their short name;
 * grid map vectors ("waveA1Value.waveTime") are skipped.
 * Numeric fill values (-999.99) become NaN.
 */
export function parseAscii(text) {
  const sep = text.search(/^-{10,}\s*$/m);
  if (sep < 0) throw new Error('Unexpected OPeNDAP response (no data section)');
  const body = text.slice(text.indexOf('\n', sep) + 1);
  const out = {};
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const head = lines[0].match(/^([\w.]+)((?:\[\d+\])+)$/);
    if (head) {
      const parts = head[1].split('.');
      if (parts.length === 2 && parts[0] !== parts[1]) continue; // grid map vector
      const name = parts[parts.length - 1];
      const dims = [...head[2].matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      const values = [];
      for (const line of lines.slice(1)) {
        for (const tok of line.replace(/^\[\d+\],\s*/, '').split(',')) {
          const t = tok.trim();
          if (t) values.push(toNumber(t));
        }
      }
      out[name] = { dims, values };
    } else {
      // scalar: `name, value`  (strings are quoted)
      for (const line of lines) {
        const m = line.match(/^([\w.]+),\s*(.*)$/);
        if (!m) continue;
        const raw = m[2];
        const value = raw.startsWith('"') ? raw.slice(1, -1) : toNumber(raw);
        out[m[1]] = { dims: [], values: [value] };
      }
    }
  }
  return out;
}

function toNumber(t) {
  const v = Number(t);
  return Number.isFinite(v) && Math.abs(v - FILL_VALUE) > 1e-3 ? v : NaN;
}

export function datasetUrl(platform) {
  return `${THREDDS_BASE}/${platform}_rt.nc`;
}

async function getText(fetchFn, url) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from THREDDS for ${url}`);
  return res.text();
}

// Brackets are left unescaped — THREDDS rejects percent-encoded constraints.
const scalarVars = ['waveTime', 'waveFlagPrimary', 'waveHs', 'waveTp', 'waveDp'];
const spectralVars = ['waveEnergyDensity', 'waveA1Value', 'waveB1Value', 'waveA2Value', 'waveB2Value'];

/**
 * Fetch the latest good wave record for a CDIP platform (e.g. "100p1").
 *  1. constrained DDS → length of waveTime (N) and waveFrequency (F)
 *  2. scalars for the last `lookback` records → newest one flagged good
 *  3. spectra + moments for that single record
 */
export async function fetchLatestRecord(platform, { fetchFn = fetch, lookback = 6 } = {}) {
  const base = datasetUrl(platform);
  const dims = parseDdsDims(await getText(fetchFn, `${base}.dds?waveTime,waveFrequency`));
  const N = dims.waveTime, F = dims.waveFrequency;
  if (!N || !F) throw new Error(`No wave data in ${platform}`);

  const lo = Math.max(0, N - lookback), hi = N - 1;
  const q1 = [
    ...scalarVars.map((v) => `${v}[${lo}:${hi}]`),
    `waveFrequency[0:${F - 1}]`, `waveBandwidth[0:${F - 1}]`, 'metaStationName',
  ].join(',');
  const s = parseAscii(await getText(fetchFn, `${base}.ascii?${q1}`));

  const flags = s.waveFlagPrimary.values;
  let k = -1;
  for (let i = flags.length - 1; i >= 0; i--) {
    if (flags[i] === FLAG_GOOD && Number.isFinite(s.waveHs.values[i])) { k = i; break; }
  }
  if (k < 0) throw new Error(`No good-quality record in the last ${lookback} samples`);
  const idx = lo + k;

  const q2 = spectralVars.map((v) => `${v}[${idx}][0:${F - 1}]`).join(',');
  const sp = parseAscii(await getText(fetchFn, `${base}.ascii?${q2}`));

  return buildRecord(platform, {
    time: s.waveTime.values[k],
    flag: flags[k] === FLAG_FILL ? NaN : flags[k],
    hs: s.waveHs.values[k],
    tp: s.waveTp.values[k],
    dp: s.waveDp.values[k],
    name: s.metaStationName?.values[0],
    frequency: s.waveFrequency.values,
    bandwidth: s.waveBandwidth.values,
    energy: sp.waveEnergyDensity.values,
    a1: sp.waveA1Value.values,
    b1: sp.waveB1Value.values,
    a2: sp.waveA2Value.values,
    b2: sp.waveB2Value.values,
  });
}

/** Normalised record shape used everywhere (and written to data/<id>.json). */
export function buildRecord(platform, r) {
  const round = (a) => a.map((v) => (Number.isFinite(v) ? +v.toPrecision(7) : null));
  return {
    station: platform,
    name: r.name ?? null,
    time: new Date(r.time * 1000).toISOString(),
    hs: r.hs, tp: r.tp, dp: r.dp,
    flag: r.flag,
    frequency: round(r.frequency),
    bandwidth: round(r.bandwidth),
    energy: round(r.energy),
    a1: round(r.a1), b1: round(r.b1), a2: round(r.a2), b2: round(r.b2),
  };
}

/** JSON null → NaN so downstream maths can use Number.isFinite uniformly. */
export function hydrateRecord(rec) {
  const arr = (a) => (a || []).map((v) => (v === null ? NaN : v));
  return {
    ...rec,
    frequency: arr(rec.frequency), bandwidth: arr(rec.bandwidth), energy: arr(rec.energy),
    a1: arr(rec.a1), b1: arr(rec.b1), a2: arr(rec.a2), b2: arr(rec.b2),
  };
}
