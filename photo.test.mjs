import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoVerdict, maxPairDistance, shouldLearn, addLive, LIMITS } from './logic.js';

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

test('wajah baru dipelajari hanya bila cocoknya jelas dan penampilannya berbeda', () => {
  // cocok jelas, tampak berbeda dari sampel asli (mis. memakai kacamata)
  assert.equal(shouldLearn({ distance: 0.4, plain: 0.45, margin: 0.2, ambang: 0.5 }), true);
  // selisih dengan karyawan lain terlalu tipis
  assert.equal(shouldLearn({ distance: 0.4, plain: 0.45, margin: 0.07, ambang: 0.5 }), false);
  // terlalu dekat ambang
  assert.equal(shouldLearn({ distance: 0.49, plain: 0.49, margin: 0.3, ambang: 0.5 }), false);
  // sudah sangat mirip sampel lama, tidak perlu disimpan
  assert.equal(shouldLearn({ distance: 0.12, plain: 0.12, margin: 0.5, ambang: 0.5 }), false);
  // hanya satu karyawan: syarat jarak lebih ketat
  assert.equal(shouldLearn({ distance: 0.45, plain: 0.45, margin: Infinity, ambang: 0.5 }), false);
  assert.equal(shouldLearn({ distance: 0.38, plain: 0.38, margin: Infinity, ambang: 0.5 }), true);
});

test('sampel yang dipelajari dibatasi dan yang lama dibuang', () => {
  let p = { live: [] };
  for (let i = 0; i < LIMITS.live + 2; i++) p = { live: addLive(p, [i]) };
  assert.equal(p.live.length, LIMITS.live);
  assert.deepEqual(p.live[0], [2]);
});
