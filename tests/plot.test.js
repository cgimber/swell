import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareField, sampleField, visibleMax, rangeLimits } from '../src/plot.js';
import { RANGES } from '../src/config.js';

const row = (v) => Float64Array.from({ length: 180 }, () => v);
const dirs = Array.from({ length: 180 }, (_, i) => i * 2);

test('prepareField fills skipped bands by interpolation', () => {
  const f = prepareField({ dirs, step: 2, S: [row(1), null, row(3)] }, [0.1, 0.2, 0.3]);
  assert.equal(f.data.length, 3);
  assert.ok(Math.abs(f.data[1][0] - 2) < 1e-12);
});

test('sampleField interpolates in frequency and wraps in direction', () => {
  const r = row(0); r[179] = 4; r[0] = 0; // 358° = 4, 0° = 0
  const f = prepareField({ dirs, step: 2, S: [r, r] }, [0.1, 0.2]);
  assert.equal(sampleField(f, 0.15, 359), 2);
  assert.ok(Number.isNaN(sampleField(f, 0.05, 0)));
});

test('visibleMax only looks at the visible frequency range', () => {
  const f = prepareField({ dirs, step: 2, S: [row(9), row(1)] }, [0.05, 0.2]);
  assert.equal(visibleMax(f, 0.1, 0.3), 1);
});

test('swell range is 8–33 s; high-freq range is clamped to measured bands', () => {
  const freq = [0.025, 0.58], bw = [0.005, 0.01];
  const s = rangeLimits(RANGES.swell, freq, bw);
  assert.ok(Math.abs(s.fLo - 1 / 33) < 1e-12 && Math.abs(s.fHi - 1 / 8) < 1e-12);
  assert.ok(Math.abs(rangeLimits(RANGES.high, freq, bw).fHi - 0.585) < 1e-12);
});

test('radialScale maps maxPeriod to the centre hole and minPeriod to the rim, and inverts', async () => {
  const { radialScale } = await import('../src/plot.js');
  for (const scale of ['log', 'linear']) {
    const m = radialScale(1 / 33, 1 / 8, 100, { scale, hole: 0.1 });
    assert.ok(Math.abs(m.fToR(1 / 33) - 10) < 1e-9);
    assert.ok(Math.abs(m.fToR(1 / 8) - 100) < 1e-9);
    assert.ok(Math.abs(m.rToF(m.fToR(0.07)) - 0.07) < 1e-12);
    assert.ok(m.fToR(1 / 16) < m.fToR(1 / 10), 'longer periods sit closer to the centre');
  }
});
