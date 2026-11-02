#!/usr/bin/env node
// Writes data/<station>.json with the latest good record per station, and
// data/<station>.forecast.json with CDIP's model run (the page trims it), for
// DATA_SOURCE = "static". Only rewrites a file when the record changed, so
// the workflow commits only real updates. Usage: node scripts/fetch-data.mjs [ids…]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { STATIONS } from '../src/config.js';
import { fetchLatestRecord, fetchForecast } from '../src/opendap.js';
import { meanDirection, peakIndex, angleDiff } from '../src/mem.js';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : STATIONS.map((s) => s.id);
const outDir = new URL('../data/', import.meta.url);
await mkdir(outDir, { recursive: true });

let failures = 0;
for (const id of ids) {
  try {
    const rec = await fetchLatestRecord(id);
    const file = new URL(`${id}.json`, outDir);
    const json = JSON.stringify(rec, null, 0) + '\n';
    const old = await readFile(file, 'utf8').catch(() => '');
    // Direction-convention sanity check against the buoy's own Dp.
    const i = peakIndex(rec.energy);
    const md = meanDirection(rec.a1[i], rec.b1[i]);
    const note = Number.isFinite(rec.dp) ? ` atan2(b1,a1)@peak=${md.toFixed(1)}° Dp=${rec.dp}° Δ=${angleDiff(md, rec.dp).toFixed(1)}°` : '';
    if (old === json) {
      console.log(`${id}: unchanged (${rec.time})${note}`);
    } else {
      await writeFile(file, json);
      console.log(`${id}: updated → ${rec.time} Hs=${rec.hs} m${note}`);
    }
    // the whole forecast ahead, so the cached file stays useful between runs
    const fc = await fetchForecast(id, { aheadHours: 24 * 8 }).catch((err) => console.error(`${id}: forecast ${err.message}`));
    if (fc) {
      const fcFile = new URL(`${id}.forecast.json`, outDir);
      const fcJson = JSON.stringify(fc) + '\n';
      if ((await readFile(fcFile, 'utf8').catch(() => '')) !== fcJson) await writeFile(fcFile, fcJson);
    }
  } catch (err) {
    failures++;
    console.error(`${id}: ${err.message}`);
  }
}
if (failures === ids.length) process.exit(1);
