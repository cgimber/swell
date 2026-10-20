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

test('range limits and radius match CDIP geometry', async () => {
  const { radialScale } = await import('../src/plot.js');
  // Ring radii measured on CDIP's 350 px plots (centre 175, rim 175 px)
  const cases = [['swell', [[22, 84], [16, 105], [12, 130], [10, 150]]], ['normal', [[20, 51], [12, 66], [8, 84], [6, 103], [4, 139]]],
    ['high', [[20, 39], [12, 46], [8, 54], [6, 62], [4, 78], [2, 127]]]];
  for (const [key, rings] of cases) {
    const { fLo, fHi } = rangeLimits(RANGES[key]);
    assert.ok(Math.abs(fLo - 1 / 33) < 1e-12);
    const m = radialScale(fHi, 175);
    for (const [T, r] of rings) assert.ok(Math.abs(m.fToR(1 / T) - r) < 2.5, `${key} ${T}s: ${m.fToR(1 / T).toFixed(1)} vs ${r}`);
    assert.ok(Math.abs(m.rToF(m.fToR(0.07)) - 0.07) < 1e-12);
  }
});

test('colour mapping follows CDIP: floor offset and transparency cutoff', async () => {
  const { rampPosition } = await import('../src/colormap.js');
  const { COLOR_FLOOR, TRANSPARENT_BELOW } = await import('../src/config.js');
  assert.ok(Number.isNaN(rampPosition(TRANSPARENT_BELOW / 2)));
  assert.ok(Math.abs(rampPosition(0.5) - (COLOR_FLOOR + (1 - COLOR_FLOOR) * 0.5)) < 1e-12);
  assert.equal(rampPosition(1), 1);
  assert.ok(rampPosition(TRANSPARENT_BELOW) > 0.09 && rampPosition(TRANSPARENT_BELOW) < 0.12, 'weak energy starts dark blue');
});

test('inGap handles the omitted wedge, including wrap-around', async () => {
  const { inGap } = await import('../src/plot.js');
  const gap = [0, 135];
  assert.ok(inGap(0, gap) && inGap(90, gap) && inGap(134.9, gap) && inGap(360, gap));
  assert.ok(!inGap(135, gap) && !inGap(200, gap) && !inGap(359.9, gap) && !inGap(-1, gap));
  assert.ok(inGap(350, [330, 30]) && inGap(10, [330, 30]) && !inGap(40, [330, 30]));
  assert.ok(!inGap(90, null));
});

test('gapEnergyFraction measures how much visible energy the gap hides', async () => {
  const { gapEnergyFraction } = await import('../src/plot.js');
  const r = Float64Array.from({ length: 72 }, (_, k) => (k * 5 < 135 ? 1 : 0) + (k * 5 >= 180 && k * 5 < 360 ? 3 : 0));
  const field = prepareField({ dirs: Array.from({ length: 72 }, (_, k) => k * 5), step: 5, S: [r, r] }, [0.05, 0.06]);
  const inGapSum = 27, outSum = 36 * 3;
  assert.ok(Math.abs(gapEnergyFraction(field, [0, 135], 0.04, 0.07) - inGapSum / (inGapSum + outSum)) < 1e-12);
  assert.equal(gapEnergyFraction(field, null, 0.04, 0.07), 0);
});
