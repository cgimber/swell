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

test('discrete colour levels use round band edges covering the maximum', async () => {
  const { levelStep, levelIndex, formatEdge, LEVEL_COLORS } = await import('../src/colormap.js');
  assert.equal(LEVEL_COLORS.length, 10);
  assert.ok(Math.abs(levelStep(0.384) - 0.04) < 1e-12);
  assert.ok(Math.abs(levelStep(0.103) - 0.012) < 1e-12);
  assert.ok(Math.abs(levelStep(0.5) - 0.05) < 1e-12);
  assert.ok(Math.abs(levelStep(0.036) - 0.004) < 1e-12);
  for (const vmax of [0.034, 0.07, 0.212, 0.417, 1.3, 9.9]) {
    const step = levelStep(vmax);
    assert.ok(step * 10 >= vmax - 1e-12 && step * 10 < vmax * 2, `${vmax} → ${step}`);
    assert.equal(levelIndex(vmax, step), Math.min(9, Math.floor(vmax / step + 1e-9)));
  }
  assert.equal(levelIndex(0.039, 0.04), 0);
  assert.equal(levelIndex(0.04, 0.04), 1);
  assert.equal(levelIndex(5, 0.04), 9, 'clamped to the top band');
  assert.equal(levelIndex(NaN, 0.04), 0);
  assert.equal(formatEdge(3 * 0.04), '0.12');
  assert.equal(formatEdge(0), '0');
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
