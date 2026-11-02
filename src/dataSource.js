// Single entry point for loading station data. Switch modes in config.js.
import { DATA_SOURCE, TREND } from './config.js';
import { fetchLatestRecord, fetchForecast, hydrateRecord, DataError } from './opendap.js';

export async function loadStation(id, { source = DATA_SOURCE, fetchFn = fetch.bind(globalThis) } = {}) {
  let rec;
  if (source === 'direct') {
    rec = await fetchLatestRecord(id, { fetchFn });
  } else if (source === 'static') {
    rec = await getJson(fetchFn, `data/${id}.json`, `No cached data for ${id}`);
  } else {
    throw new Error(`Unknown DATA_SOURCE "${source}"`);
  }
  return { ...hydrateRecord(rec), source };
}

/** Modelled Hs/Tp around now: { station, series: [{ t, hs, tp }] }. */
export async function loadForecast(id, { source = DATA_SOURCE, fetchFn = fetch.bind(globalThis) } = {}) {
  const window = { pastHours: TREND.pastHours, aheadHours: TREND.aheadHours };
  if (source === 'direct') return fetchForecast(id, { fetchFn, ...window });
  if (source === 'static') {
    // the cached file holds the whole tail of the run; trim it to the window here
    const fc = await getJson(fetchFn, `data/${id}.forecast.json`, `No cached forecast for ${id}`);
    const now = Date.now();
    const series = fc.series.filter((p) => p.t >= now - window.pastHours * 3.6e6 && p.t <= now + window.aheadHours * 3.6e6);
    if (!series.length || series.at(-1).t < now) throw new DataError(`No current forecast for ${id}`);
    return { ...fc, series };
  }
  throw new Error(`Unknown DATA_SOURCE "${source}"`);
}

async function getJson(fetchFn, url, missing) {
  const res = await fetchFn(url, { cache: 'no-cache' });
  if (!res.ok) throw new DataError(missing, { status: res.status });
  return res.json();
}
