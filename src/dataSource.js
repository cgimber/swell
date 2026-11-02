// Single entry point for loading station data. Switch modes in config.js.
import { DATA_SOURCE, TREND } from './config.js';
import { fetchLatestRecord, fetchForecast, hydrateRecord, DataError } from './opendap.js';

// In "auto" mode the page asks THREDDS first and falls back to the cached
// data/*.json. CDIP's load balancer answers 403, with no CORS header, to whole
// regions (Japan, much of Europe and Asia), and the browser reports that as a
// network error with no status. Once that has happened and the cache worked,
// the rest of the visit goes to the cache first, so each station switch skips
// the failing request and its retry.
let preferCache = false;

/** Forget the preference "auto" mode learns during a visit (for tests). */
export function resetSourcePreference() { preferCache = false; }

export async function loadStation(id, { source = DATA_SOURCE, fetchFn = fetch.bind(globalThis), ...httpOpts } = {}) {
  const loaders = {
    direct: () => fetchLatestRecord(id, { fetchFn, ...httpOpts }),
    static: () => getJson(fetchFn, `data/${id}.json`, `No cached data for ${id}`),
  };
  const { value, source: used } = await loadFrom(source, loaders);
  return { ...hydrateRecord(value), source: used };
}

/** Modelled Hs/Tp around now: { station, series: [{ t, hs, tp }], source }. */
export async function loadForecast(id, { source = DATA_SOURCE, fetchFn = fetch.bind(globalThis), now = Date.now(), ...httpOpts } = {}) {
  const window = { pastHours: TREND.pastHours, aheadHours: TREND.aheadHours };
  const loaders = {
    direct: () => fetchForecast(id, { fetchFn, now, ...window, ...httpOpts }),
    static: async () => {
      // the cached file holds the whole tail of the run; trim it to the window here
      const fc = await getJson(fetchFn, `data/${id}.forecast.json`, `No cached forecast for ${id}`);
      const series = fc.series.filter((p) => p.t >= now - window.pastHours * 3.6e6 && p.t <= now + window.aheadHours * 3.6e6);
      if (!series.length || series.at(-1).t < now) throw new DataError(`No current forecast for ${id}`);
      return { ...fc, series };
    },
  };
  const { value, source: used } = await loadFrom(source, loaders);
  return { ...value, source: used };
}

async function loadFrom(source, loaders) {
  if (source === 'direct' || source === 'static') return { value: await loaders[source](), source };
  if (source !== 'auto') throw new Error(`Unknown DATA_SOURCE "${source}"`);

  const order = preferCache ? ['static', 'direct'] : ['direct', 'static'];
  let directErr = null;
  for (const s of order) {
    try {
      const value = await loaders[s]();
      if (s === 'static' && directErr && directErr.status == null) preferCache = true;
      return { value, source: s };
    } catch (err) {
      if (s === 'direct') directErr = err;
      else if (order[0] === 'static') continue; // preferred cache missing: still try THREDDS
      else throw directErr; // both failed: THREDDS's error says more than a missing cache file
    }
  }
  throw directErr;
}

async function getJson(fetchFn, url, missing) {
  let res;
  try {
    res = await fetchFn(url, { cache: 'no-cache' });
  } catch (cause) {
    throw new DataError(`Couldn't reach this site's cached data`, { url, cause });
  }
  if (!res.ok) throw new DataError(missing, { status: res.status, url });
  return res.json();
}
