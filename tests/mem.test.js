import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memSpread, directionGrid, directionalSpectrum, meanDirection, peakIndex, angleDiff } from '../src/mem.js';
import { parseAscii } from '../src/opendap.js';

const STEP = 1;
const dirs = directionGrid(STEP);
const argmax = (a) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);

// Moments of a single-direction spread centred on θ0 (nautical "from"):
// a1 + i b1 = r1 e^{iθ0}, a2 + i b2 = r2 e^{2iθ0}. r1/r2 are typical of a
// clean swell band in CDIP data. (MEM is the AR(2) spectrum of the moments:
// when r2 is well below r1² it legitimately splits a peak in two, so textbook
// cos-2s moments are not a fair "single direction" input.)
function moments(theta0, r1 = 0.85, r2 = 0.65) {
  const t = (theta0 * Math.PI) / 180;
  return [r1 * Math.cos(t), r1 * Math.sin(t), r2 * Math.cos(2 * t), r2 * Math.sin(2 * t)];
}

test('MEM peak lands on the input direction for a synthetic single-direction spectrum', () => {
  for (const theta0 of [0, 37, 90, 180, 213, 270, 290, 359]) {
    const D = memSpread(...moments(theta0), dirs, STEP);
    const peak = dirs[argmax(D)];
    assert.ok(Math.abs(angleDiff(peak, theta0)) <= STEP, `θ0=${theta0} → peak ${peak}`);
  }
});

test('MEM spreading integrates to 1 over 360°', () => {
  const D = memSpread(...moments(250, 0.6, 0.3), dirs, STEP);
  const sum = D.reduce((s, v) => s + v, 0) * STEP;
  assert.ok(Math.abs(sum - 1) < 1e-9, `∫D = ${sum}`);
});

test('S(f,θ) integrates back to E(f)', () => {
  const [a1, b1, a2, b2] = moments(200, 0.7, 0.4);
  const rec = { frequency: [0.07, 0.1], energy: [2.5, 0.4], a1: [a1, a1], b1: [b1, b1], a2: [a2, a2], b2: [b2, b2] };
  const spec = directionalSpectrum(rec, 2);
  spec.S.forEach((row, i) => {
    const e = row.reduce((s, v) => s + v, 0) * spec.step;
    assert.ok(Math.abs(e - rec.energy[i]) < 1e-9);
  });
});

test('bands with |c1| >= 1 or NaN/fill values are skipped', () => {
  assert.equal(memSpread(1, 0, 0.5, 0, dirs, STEP), null);
  assert.equal(memSpread(0.8, 0.7, 0.2, 0.1, dirs, STEP), null); // |c1| > 1
  assert.equal(memSpread(NaN, 0, 0, 0, dirs, STEP), null);
  const rec = { frequency: [0.1, 0.2], energy: [NaN, 1], a1: [0.5, 0.5], b1: [0, 0], a2: [0, 0], b2: [0, 0] };
  const spec = directionalSpectrum(rec, 2);
  assert.equal(spec.S[0], null);
  assert.ok(spec.S[1]);
});

// Direction convention, verified against real CDIP realtime records
// (fixtures captured from THREDDS on 2026-10-15): atan2(b1, a1) at the peak
// band equals waveDp, the nautical direction waves come FROM — no rotation or
// sign flip needed. The MEM peak at that band must agree too.
for (const st of ['100p1', '153p1', '191p1', '201p1', '220p1']) {
  test(`direction convention matches waveDp for real ${st} data`, () => {
    const d = parseAscii(readFileSync(new URL(`./fixtures/${st}.ascii.txt`, import.meta.url), 'utf8'));
    const last = d.waveDp.values.length - 1;
    const dp = d.waveDp.values[last];
    const E = d.waveEnergyDensity.values;
    const i = peakIndex(E);
    const a1 = d.waveA1Value.values[i], b1 = d.waveB1Value.values[i];
    const md = meanDirection(a1, b1);
    assert.ok(Math.abs(angleDiff(md, dp)) < 1, `${st}: atan2(b1,a1)=${md.toFixed(2)} vs waveDp=${dp}`);
    const D = memSpread(a1, b1, d.waveA2Value.values[i], d.waveB2Value.values[i], dirs, STEP);
    const memPeak = dirs[argmax(D)];
    assert.ok(Math.abs(angleDiff(memPeak, dp)) < 20, `${st}: MEM peak ${memPeak} vs waveDp=${dp}`);
  });
}
