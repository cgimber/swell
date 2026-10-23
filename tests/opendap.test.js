import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAscii, parseDdsDims, fetchLatestRecord, hydrateRecord, DataError } from '../src/opendap.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('parseDdsDims reads waveTime / waveFrequency lengths from a real DDS', () => {
  const dims = parseDdsDims(fx('100p1.dds.txt'));
  assert.equal(dims.waveTime, 8175);
  assert.equal(dims.waveFrequency, 64);
});

test('parseAscii handles 1-D, 2-D grid and string scalar blocks', () => {
  const d = parseAscii(fx('100p1.ascii.txt'));
  assert.deepEqual(d.waveTime.dims, [3]);
  assert.equal(d.waveTime.values.length, 3);
  assert.equal(d.waveFrequency.values.length, 64);
  assert.equal(d.waveFrequency.values[0], 0.025);
  assert.deepEqual(d.waveEnergyDensity.dims, [1, 64]);
  assert.equal(d.waveEnergyDensity.values.length, 64);
  for (const v of ['waveA1Value', 'waveB1Value', 'waveA2Value', 'waveB2Value']) assert.equal(d[v].values.length, 64);
  assert.match(d.metaStationName.values[0], /TORREY PINES OUTER/);
});

test('parseAscii turns the -999.99 fill value into NaN', () => {
  const txt = 'Dataset {\n} x;\n---------------------------------------------\nwaveHs[3]\n1.2, -999.99, 0.8\n';
  const d = parseAscii(txt);
  assert.equal(d.waveHs.values[0], 1.2);
  assert.ok(Number.isNaN(d.waveHs.values[1]));
});

test('fetchLatestRecord makes only constrained requests for the last record', async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    const body = url.includes('.dds?') ? fx('100p1.dds.txt') : fx('100p1.ascii.txt');
    return { ok: true, status: 200, text: async () => body };
  };
  const rec = hydrateRecord(await fetchLatestRecord('100p1', { fetchFn, lookback: 3 }));
  assert.equal(urls.length, 3);
  assert.ok(urls[0].endsWith('100p1_rt.nc.dds?waveTime,waveFrequency'));
  assert.ok(urls[1].includes('waveTime[8172:8174]'));
  assert.ok(urls[2].includes('waveEnergyDensity[8174][0:63]'));
  for (const u of urls) assert.ok(/\.(dds|ascii)\?/.test(u), 'every request is constrained');
  assert.equal(rec.station, '100p1');
  assert.equal(rec.frequency.length, 64);
  assert.equal(rec.energy.length, 64);
  assert.ok(Number.isFinite(rec.hs) && Number.isFinite(rec.dp));
  assert.match(rec.time, /^\d{4}-\d\d-\d\dT/);
});

// A fetch stub that answers with `statuses` in order (then 200s) and serves fixtures.
function flakyFetch(statuses) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const status = statuses.shift() ?? 200;
    const body = url.includes('.dds?') ? fx('100p1.dds.txt') : fx('100p1.ascii.txt');
    return { ok: status === 200, status, text: async () => body };
  };
  return { fetchFn, calls };
}
const fast = { lookback: 3, retryDelayMs: 0 };

test('a temporary 404 is retried once and then succeeds', async () => {
  const { fetchFn, calls } = flakyFetch([404]);
  const rec = await fetchLatestRecord('100p1', { fetchFn, ...fast });
  assert.equal(rec.station, '100p1');
  assert.equal(calls.length, 4, 'one retry plus the three normal requests');
});

test('a persistent 404 fails with a DataError carrying the status', async () => {
  const { fetchFn } = flakyFetch([404, 404]);
  await assert.rejects(fetchLatestRecord('201p1', { fetchFn, ...fast }), (err) => {
    assert.ok(err instanceof DataError);
    assert.equal(err.status, 404);
    assert.doesNotMatch(err.message, /https?:/, 'no raw URL in the user-facing message');
    return true;
  });
});

test('non-retryable statuses fail straight away', async () => {
  const { fetchFn, calls } = flakyFetch([400]);
  await assert.rejects(fetchLatestRecord('100p1', { fetchFn, ...fast }), (err) => err.status === 400);
  assert.equal(calls.length, 1);
});

test('a stalled request times out instead of hanging', async () => {
  const fetchFn = (url, opts) => new Promise((_, reject) => {
    opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(fetchLatestRecord('100p1', { fetchFn, timeoutMs: 20, retryDelayMs: 0 }), (err) => {
    assert.ok(err instanceof DataError);
    assert.match(err.message, /too long/);
    return true;
  });
});
