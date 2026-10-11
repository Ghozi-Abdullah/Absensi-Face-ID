import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoVerdict, maxPairDistance, shouldLearn, MAX_SAMPLES } from './logic.js';

const f = (w, d = [0, 0]) => ({ box: { x: 0, y: 0, width: w, height: w }, descriptor: d });

test('foto tanpa wajah ditolak', () => {
  assert.equal(photoVerdict([]).status, 'none');
});

test('wajah terlalu kecil di foto ditolak', () => {
  assert.equal(photoVerdict([f(40)]).status, 'small');
});

test('foto berisi beberapa wajah memakai wajah terbesar dan memberi peringatan', () => {
  const v = photoVerdict([f(90, [1, 1]), f(150, [2, 2]), f(80)]);
  assert.equal(v.status, 'ok');
  assert.equal(v.warn, true);
  assert.deepEqual(v.face.descriptor, [2, 2]);
});

test('jarak antar-foto mendeteksi foto dari orang berbeda', () => {
  assert.ok(maxPairDistance([[0, 0], [0.1, 0], [0, 0.1]]) < 0.2);
  assert.ok(maxPairDistance([[0, 0], [1, 0]]) > 0.6);
  assert.equal(maxPairDistance([[0, 0]]), 0);
});

test('belajar dari kamera hanya untuk karyawan dari foto, cocok meyakinkan, dan belum penuh', () => {
  const p = { source: 'foto', descriptors: [[0], [1]] };
  assert.equal(shouldLearn(p, 0.30, 0.5), true);
  assert.equal(shouldLearn(p, 0.47, 0.5), false);
  assert.equal(shouldLearn({ ...p, source: undefined }, 0.3, 0.5), false);
  assert.equal(shouldLearn({ ...p, descriptors: Array(MAX_SAMPLES).fill([0]) }, 0.3, 0.5), false);
});
