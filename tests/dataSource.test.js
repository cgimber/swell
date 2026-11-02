import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadStation, loadForecast, resetSourcePreference } from '../src/dataSource.js';
import { DataError } from '../src/opendap.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const fast = { retryDelayMs: 0, lookback: 3 };
const cachedRecord = fx('100p1-20261016T0300.json');
const now = Date.parse('2026-11-02T05:30:00Z');

// A fetch that behaves like the network seen from a given place.
//   thredds: 'ok' | 'blocked' (403 without CORS → TypeError) | 404
//   cache:   'ok' | 404
function network({ thredds = 'ok', cache = 'ok' } = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.startsWith('https://thredds.cdip.ucsd.edu/')) {
      if (thredds === 'blocked') throw new TypeError('Load failed');
      if (thredds !== 'ok') return { ok: false, status: thredds, text: async () => '' };
      const model = url.includes('MOP_validation');
      const body = url.includes('.dds?')
        ? fx(model ? 'BP100_ecmwf_fc.dds.txt' : '100p1.dds.txt')
        : fx(model ? 'BP100_ecmwf_fc.ascii.txt' : '100p1.ascii.txt');
      return { ok: true, status: 200, text: async () => body };
    }
    if (cache !== 'ok') return { ok: false, status: cache, json: async () => { throw new Error('not json'); } };
    if (url === 'data/100p1.json') return { ok: true, status: 200, json: async () => JSON.parse(cachedRecord) };
    if (url === 'data/100p1.forecast.json') {
      // a cached run around `now`: hourly from 2 days before to 8 days after
      const series = [];
      for (let h = -48; h <= 8 * 24; h++) series.push({ t: now + h * 3.6e6, hs: 1, tp: 14 });
      return { ok: true, status: 200, json: async () => ({ station: '100p1', series }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const counts = () => ({
    thredds: calls.filter((u) => u.startsWith('https://')).length,
    cache: calls.filter((u) => u.startsWith('data/')).length,
  });
  return { fetchFn, calls, counts };
}

beforeEach(() => resetSourcePreference());

test('auto: reads THREDDS when it is reachable, and never touches the cache', async () => {
  const net = network();
  const rec = await loadStation('100p1', { source: 'auto', fetchFn: net.fetchFn, ...fast });
  assert.equal(rec.source, 'direct');
  assert.deepEqual(net.counts(), { thredds: 3, cache: 0 });
});

test('auto: falls back to the cached copy when THREDDS is blocked (403 without CORS)', async () => {
  const net = network({ thredds: 'blocked' });
  const rec = await loadStation('100p1', { source: 'auto', fetchFn: net.fetchFn, ...fast });
  assert.equal(rec.source, 'static');
  assert.equal(rec.time, '2026-10-16T03:00:00.000Z');
  assert.equal(rec.frequency.length, 64);
  assert.ok(net.calls.includes('data/100p1.json'));
});

test('auto: after a blocked THREDDS, later loads go straight to the cache', async () => {
  const first = network({ thredds: 'blocked' });
  await loadStation('100p1', { source: 'auto', fetchFn: first.fetchFn, ...fast });
  const next = network({ thredds: 'blocked' });
  const rec = await loadStation('100p1', { source: 'auto', fetchFn: next.fetchFn, ...fast });
  assert.equal(rec.source, 'static');
  assert.deepEqual(next.counts(), { thredds: 0, cache: 1 });
});

test('auto: an HTTP error from THREDDS falls back without changing the order for later loads', async () => {
  const first = network({ thredds: 404 });
  assert.equal((await loadStation('100p1', { source: 'auto', fetchFn: first.fetchFn, ...fast })).source, 'static');
  const next = network();
  assert.equal((await loadStation('100p1', { source: 'auto', fetchFn: next.fetchFn, ...fast })).source, 'direct');
  assert.equal(next.counts().cache, 0);
});

test('auto: when both fail, the THREDDS error is reported', async () => {
  const net = network({ thredds: 'blocked', cache: 404 });
  await assert.rejects(loadStation('100p1', { source: 'auto', fetchFn: net.fetchFn, ...fast }), (err) => {
    assert.ok(err instanceof DataError);
    assert.match(err.message, /Couldn't reach CDIP's data server/);
    return true;
  });
});

test('auto: a missing cache file after a blocked visit still tries THREDDS', async () => {
  await loadStation('100p1', { source: 'auto', fetchFn: network({ thredds: 'blocked' }).fetchFn, ...fast });
  const net = network({ cache: 404 });
  const rec = await loadStation('100p1', { source: 'auto', fetchFn: net.fetchFn, ...fast });
  assert.equal(rec.source, 'direct');
});

test('auto: the forecast falls back to the cached run, trimmed to the window', async () => {
  const net = network({ thredds: 'blocked' });
  const fc = await loadForecast('100p1', { source: 'auto', fetchFn: net.fetchFn, now, retryDelayMs: 0 });
  assert.equal(fc.source, 'static');
  assert.equal(fc.series[0].t, now - 24 * 3.6e6);
  assert.equal(fc.series.at(-1).t, now + 72 * 3.6e6);
});

test('direct and static modes do not fall back', async () => {
  await assert.rejects(loadStation('100p1', { source: 'direct', fetchFn: network({ thredds: 'blocked' }).fetchFn, ...fast }), DataError);
  const net = network({ thredds: 'blocked' });
  assert.equal((await loadStation('100p1', { source: 'static', fetchFn: net.fetchFn })).source, 'static');
  assert.equal(net.counts().thredds, 0);
});
