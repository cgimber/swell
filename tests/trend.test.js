import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAscii } from '../src/opendap.js';
import { smooth, valueAt, trendAt, turningPoints, nextTurningPoint, nextChange, sparkGeometry } from '../src/trend.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const series = (name) => {
  const d = parseAscii(fx(name));
  return d.waveTime.values.map((s, i) => ({ t: s * 1000, hs: d.waveHs.values[i], tp: d.waveTp.values[i] }));
};
// CDIP's ECMWF-driven run at 100p1 and the buoy's own last 24 h, both captured
// at 2026-11-02 05:30 UTC: Hs just past a 2 m peak, a low on Tue, a 1.6 m
// pulse on Wed.
const fc = series('BP100_ecmwf_fc.ascii.txt');
const obs = series('100p1-history.ascii.txt');
const now = Date.parse('2026-11-02T05:30:00Z');
const H = 3.6e6;
const iso = (t) => new Date(t).toISOString().slice(0, 13);

// a synthetic hourly series from a function of hours after `now`
const synth = (f, from = -24, to = 72) => Array.from({ length: to - from + 1 }, (_, i) => {
  const h = from + i;
  return { t: now + h * H, hs: f(h), tp: 12 };
});

test('smooth takes a rolling median, so a single spike disappears', () => {
  const s = synth((h) => (h === 0 ? 5 : 1));
  const m = smooth(s, 'hs', 3);
  assert.equal(valueAt(m, now), 1);
  assert.equal(m.length, s.length);
});

test('valueAt interpolates and is NaN outside the series', () => {
  const s = [{ t: 0, v: 1 }, { t: 10, v: 3 }];
  assert.equal(valueAt(s, 5), 2);
  assert.ok(Number.isNaN(valueAt(s, 11)));
});

test('trendAt reads the forecast change over the next few hours', () => {
  assert.equal(trendAt(obs, fc, now, 'hs').dir, 'down');
  assert.equal(trendAt(obs, fc, now, 'hs').basis, 'forecast');
  assert.equal(trendAt(obs, synth((h) => 1 + 0.05 * h), now, 'hs').dir, 'up');
  assert.equal(trendAt(obs, synth(() => 1), now, 'hs').dir, 'steady');
});

test('trendAt calls a change steady until it passes the threshold', () => {
  // Hs threshold at 1 m is max(0.1 m, 8 %) = 0.1 m over 6 h
  assert.equal(trendAt(null, synth((h) => 1 + (0.09 / 6) * h), now, 'hs').dir, 'steady');
  assert.equal(trendAt(null, synth((h) => 1 + (0.11 / 6) * h), now, 'hs').dir, 'up');
  // at 3 m the relative part wins: 0.24 m
  assert.equal(trendAt(null, synth((h) => 3 - (0.2 / 6) * h), now, 'hs').dir, 'steady');
  assert.equal(trendAt(null, synth((h) => 3 - (0.3 / 6) * h), now, 'hs').dir, 'down');
});

test('trendAt falls back to the observed record without a forecast', () => {
  const t = trendAt(obs, null, now, 'hs');
  assert.equal(t.basis, 'observed');
  assert.ok(['up', 'down', 'steady'].includes(t.dir));
  assert.equal(trendAt([], null, now, 'hs'), null);
});

test('turningPoints finds the low and the next pulse in the real forecast', () => {
  const tp = turningPoints(fc, now, 'hs');
  assert.deepEqual(tp.slice(0, 2).map((p) => [p.kind, iso(p.t)]), [['low', '2026-11-03T20'], ['peak', '2026-11-04T14']]);
  assert.ok(Math.abs(tp[1].value - 1.61) < 0.01);
  assert.equal(nextTurningPoint(fc, now, 'hs').kind, 'low');
});

test('turningPoints ignores small wiggles and reports steady or a trend at the horizon', () => {
  assert.deepEqual(turningPoints(synth((h) => 1 + 0.03 * Math.sin(h / 3)), now, 'hs').map((p) => p.kind), ['steady']);
  const rising = turningPoints(synth((h) => 1 + 0.01 * h), now, 'hs');
  assert.deepEqual(rising.map((p) => p.kind), ['rising']);
  assert.equal(iso(rising[0].t), iso(now + 72 * H));
});

test('nextChange finds the first full step in quantized Tp', () => {
  const c = nextChange(fc, now, 'tp');
  assert.equal(c.dir, 'up');
  assert.ok(c.value > 18);
  assert.equal(nextChange(synth(() => 1), now, 'hs'), null);
});

test('sparkGeometry scales both series into the box and marks now', () => {
  const g = sparkGeometry(obs, fc, now, { w: 90, h: 24, key: 'hs' });
  assert.match(g.obs, /^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+)+$/);
  assert.match(g.fc, /^M/);
  assert.ok(g.nowX > 2 && g.nowX < 88);
  for (const n of g.obs.match(/[\d.]+/g).map(Number)) assert.ok(n >= 0 && n <= 90);
  assert.ok(g.days.length >= 3 && g.days.every((x) => x > 0 && x < 90));
  const tp = sparkGeometry(obs, fc, now, { w: 90, h: 24, key: 'tp' });
  assert.match(tp.fc, /H[\d.]+V/, 'Tp is drawn as steps');
});

test('sparkGeometry splits the window into local days between the midnight ticks', () => {
  const g = sparkGeometry(obs, fc, now, { w: 90, h: 24, key: 'hs' });
  const s = g.daySpans;
  assert.equal(s.length, g.days.length + 1);
  for (let i = 0; i < g.days.length; i++) {
    assert.ok(Math.abs(s[i].x + s[i].w / 2 - g.days[i]) < 1e-9, 'each span ends at its midnight tick');
    assert.equal(new Date(s[i + 1].t).getHours(), 0, 'later spans start at local midnight');
  }
  assert.ok(Math.abs(s.reduce((a, d) => a + d.w, 0) - 86) < 1e-9, 'spans cover the whole width');
});

test('sparkGeometry places marks on the drawn forecast line', () => {
  const marks = turningPoints(fc, now, 'hs').slice(0, 2);
  const g = sparkGeometry(obs, fc, now, { w: 90, h: 24, key: 'hs', marks });
  assert.deepEqual(g.marks.map((m) => m.kind), ['low', 'peak']);
  assert.ok(g.marks[0].x > g.nowX && g.marks[1].x > g.marks[0].x);
  assert.ok(g.marks[0].y > g.marks[1].y, 'the low sits below the pulse');
  const off = sparkGeometry(obs, fc, now, { w: 90, h: 24, key: 'hs', marks: [{ t: now + 30 * 24 * H }] });
  assert.equal(off.marks.length, 0, 'marks outside the window are dropped');
  const tp = sparkGeometry(obs, fc, now, { w: 90, h: 24, key: 'tp', marks: [{ t: nextChange(fc, now, 'tp').t }] });
  assert.equal(tp.marks.length, 1);
});

test('sparkGeometry keeps a minimum y-range so flat data stays flat', () => {
  const g = sparkGeometry([], synth(() => 1), now, { w: 90, h: 24, key: 'hs' });
  assert.ok(Math.abs(g.hi - g.lo - 0.3) < 1e-9);
  assert.equal(sparkGeometry([], [], now, { w: 90, h: 24, key: 'hs' }), null);
});
