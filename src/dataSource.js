// Single entry point for loading station data. Switch modes in config.js.
import { DATA_SOURCE } from './config.js';
import { fetchLatestRecord, hydrateRecord } from './opendap.js';

export async function loadStation(id, { source = DATA_SOURCE, fetchFn = fetch.bind(globalThis) } = {}) {
  let rec;
  if (source === 'direct') {
    rec = await fetchLatestRecord(id, { fetchFn });
  } else if (source === 'static') {
    const res = await fetchFn(`data/${id}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`No cached data for ${id} (HTTP ${res.status})`);
    rec = await res.json();
  } else {
    throw new Error(`Unknown DATA_SOURCE "${source}"`);
  }
  return { ...hydrateRecord(rec), source };
}
