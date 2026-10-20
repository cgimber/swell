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

// CDIP's polar plot is MEM on the spectrum rebinned to even 0.01 Hz bands,
// averaged into 5° direction bins. Fixtures are CDIP's own output from
// https://cdip.ucsd.edu/data_access/MEM_2dspectra.cdip?sp<stn>01<YYYYMMDDHHMM>+even
// for the same records (rows 0.03…0.58 Hz, columns centred 5…360°).
const readCdipMatrix = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  .replace(/<\/?pre>/g, '').trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));

for (const [recFile, memFile, plotMax] of [
  ['100p1-20261016T0300.json', 'cdip-mem-even-100p1-20261016T0300.txt', 0.103], // Datawell Mk3, 64 bands
  ['094p1-20261019T0200.json', 'cdip-mem-even-094p1-20261019T0200.txt', 0.283], // DWR4, 100 bands
]) {
  test(`cdipSpectrum reproduces CDIP's MEM_2dspectra output (${recFile})`, async () => {
    const { cdipSpectrum } = await import('../src/mem.js');
    const { hydrateRecord } = await import('../src/opendap.js');
    const rec = hydrateRecord(JSON.parse(readFileSync(new URL(`./fixtures/${recFile}`, import.meta.url), 'utf8')));
    const M = readCdipMatrix(memFile);
    const { rec: even, spec } = cdipSpectrum(rec, { evenBandHz: 0.01, dirBinDeg: 5 });
    assert.ok(even.frequency.length >= M.length);
    assert.ok(Math.abs(even.frequency[0] - 0.03) < 1e-9 && Math.abs(even.frequency[55] - 0.58) < 1e-9);
    let cdipMax = 0, myMax = 0;
    M.forEach((row, i) => row.forEach((c, j) => {
      const mine = spec.S[i][(j + 1) % 72]; // CDIP column j is centred at 5(j+1)°; ours index k ↔ 5k°
      cdipMax = Math.max(cdipMax, c); myMax = Math.max(myMax, mine);
      if (c > 0.002) assert.ok(Math.abs(mine - c) / c < 0.005, `f=${even.frequency[i]} dir=${5 * (j + 1)}: ${mine} vs CDIP ${c}`);
      else assert.ok(Math.abs(mine - c) < 1e-5);
    }));
    assert.ok(Math.abs(myMax - cdipMax) < 1e-4);
    // CDIP's plot colour bar tops out at this matrix's maximum
    assert.ok(Math.abs(myMax - plotMax) < 0.0006, `max ${myMax} vs plot label ${plotMax}`);
  });
}

test('binDirections averages 1° MEM into bins centred on multiples of the bin width', async () => {
  const { binDirections } = await import('../src/mem.js');
  const row = Float64Array.from({ length: 360 }, (_, k) => k);
  const b = binDirections({ dirs, step: 1, S: [row, null] }, 5);
  assert.equal(b.S[0].length, 72);
  assert.equal(b.S[0][1], (3 + 4 + 5 + 6 + 7) / 5);
  assert.equal(b.S[0][0], (358 + 359 + 0 + 1 + 2) / 5);
  assert.equal(b.S[1], null);
});
