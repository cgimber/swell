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

test('smoothSpectrum keeps band energy and lowers sharp peaks', async () => {
  const { smoothSpectrum } = await import('../src/mem.js');
  const [a1, b1, a2, b2] = moments(200, 0.95, 0.85);
  const rec = { frequency: [0.06, 0.065, 0.07], energy: [1, 2, 1], a1: [a1, a1, a1], b1: [b1, b1, b1], a2: [a2, a2, a2], b2: [b2, b2, b2] };
  const raw = directionalSpectrum(rec, 1);
  const sm = smoothSpectrum(raw, { dirHalfDeg: 5, freqHalf: 0 });
  sm.S.forEach((row, i) => {
    assert.ok(Math.abs(row.reduce((s, v) => s + v, 0) - rec.energy[i]) < 1e-9, 'directional smoothing conserves energy');
    assert.ok(Math.max(...row) < Math.max(...raw.S[i]));
    assert.equal(dirs[argmax(row)], dirs[argmax(raw.S[i])]);
  });
  const both = smoothSpectrum(raw, { dirHalfDeg: 0, freqHalf: 1 });
  assert.ok(Math.abs(both.S[1][200] - (raw.S[0][200] + raw.S[1][200] + raw.S[2][200]) / 3) < 1e-12);
  assert.ok(Math.abs(both.S[0][200] - (raw.S[0][200] + raw.S[1][200]) / 2) < 1e-12, 'edges average available bands');
});

// Reference: CDIP's own polar plot for 100p1 at 2026-10-16 03:00 UTC, swell
// range (8–33 s). Its colour bar tops out at 0.103 m²/Hz/deg and the peak sits
// at ~195° between the 16 s and 12 s rings (values read back from the image's
// colours: 0.101 at 14.3 s, 195°).
test('smoothed MEM reproduces CDIP polar plot peak for a real record', async () => {
  const { smoothSpectrum } = await import('../src/mem.js');
  const { hydrateRecord } = await import('../src/opendap.js');
  const { SMOOTH_DIR_DEG, SMOOTH_FREQ_BANDS } = await import('../src/config.js');
  const rec = hydrateRecord(JSON.parse(readFileSync(new URL('./fixtures/100p1-20261016T0300.json', import.meta.url), 'utf8')));
  const sp = smoothSpectrum(directionalSpectrum(rec, 1), { dirHalfDeg: SMOOTH_DIR_DEG, freqHalf: SMOOTH_FREQ_BANDS });
  let max = 0, at = null;
  sp.S.forEach((row, i) => {
    const f = rec.frequency[i];
    if (!row || f < 1 / 33 || f > 1 / 8) return;
    row.forEach((v, k) => { if (v > max) { max = v; at = { T: 1 / f, dir: sp.dirs[k] }; } });
  });
  assert.ok(Math.abs(max - 0.101) / 0.101 < 0.15, `peak ${max.toFixed(4)} vs CDIP 0.101`);
  assert.ok(Math.abs(angleDiff(at.dir, 195)) <= 10, `peak dir ${at.dir} vs CDIP ~195`);
  assert.ok(at.T > 12 && at.T < 17, `peak period ${at.T.toFixed(1)} s`);
});
