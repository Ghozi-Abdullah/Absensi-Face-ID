import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideAction, bestMatch, buildRows, summarize, toCSV, BlinkTracker, eyeAspectRatio, initials, confidence, dateKey
} from '../js/logic.js';

const settings = { jamMasuk: '08:00', toleransi: 10, jamPulang: '17:00', jedaMinimal: 60 };
const at = (h, m, day = 12) => new Date(2026, 9, day, h, m, 0);

test('absen pertama sebelum batas toleransi = masuk tepat waktu', () => {
  const a = decideAction([], at(8, 10), settings);
  assert.equal(a.type, 'masuk');
  assert.equal(a.status, 'tepat');
});

test('absen pertama setelah toleransi = terlambat dengan menit dari jam masuk', () => {
  const a = decideAction([], at(8, 25), settings);
  assert.equal(a.status, 'terlambat');
  assert.equal(a.telatMenit, 25);
});

test('wajah terdeteksi lagi sebelum jeda minimal tidak dicatat pulang', () => {
  const logs = [{ type: 'masuk', time: at(8, 0).toISOString() }];
  const a = decideAction(logs, at(8, 40), settings);
  assert.equal(a.type, 'jeda');
  assert.equal(a.tungguMenit, 20);
});

test('pulang sebelum jam pulang ditandai pulang awal', () => {
  const logs = [{ type: 'masuk', time: at(8, 0).toISOString() }];
  assert.equal(decideAction(logs, at(15, 0), settings).status, 'pulang-awal');
  assert.equal(decideAction(logs, at(17, 5), settings).status, 'normal');
});

test('setelah masuk dan pulang, absen hari itu selesai', () => {
  const logs = [{ type: 'masuk', time: at(8, 0).toISOString() }, { type: 'pulang', time: at(17, 0).toISOString() }];
  assert.equal(decideAction(logs, at(17, 30), settings).type, 'selesai');
});

test('pencocokan memilih orang terdekat dan menolak di atas ambang', () => {
  const people = [
    { id: 'a', name: 'Rina', descriptors: [[0, 0, 0], [0.1, 0, 0]] },
    { id: 'b', name: 'Budi', descriptors: [[1, 1, 1]] }
  ];
  assert.equal(bestMatch([0.05, 0, 0], people, 0.5).person.id, 'a');
  assert.equal(bestMatch([0.5, 0.5, 0.5], people, 0.3).person, null);
  assert.ok(confidence(0.1) > confidence(0.4));
});

test('rekap menggabungkan masuk dan pulang per orang per hari', () => {
  const people = [{ id: 'a', name: 'Rina', code: 'K1', division: 'Dapur' }];
  const logs = [
    { personId: 'a', name: 'Rina', date: '2026-10-12', type: 'masuk', status: 'terlambat', time: at(8, 20).toISOString() },
    { personId: 'a', name: 'Rina', date: '2026-10-12', type: 'pulang', status: 'normal', time: at(17, 20).toISOString() },
    { personId: 'a', name: 'Rina', date: '2026-10-13', type: 'masuk', status: 'tepat', time: at(7, 50, 13).toISOString() }
  ];
  const rows = buildRows(logs, people, '2026-10-01', '2026-10-31');
  assert.equal(rows.length, 2);
  const senin = rows.find((r) => r.date === '2026-10-12');
  assert.equal(senin.durasi, 540);
  const s = summarize(rows)[0];
  assert.equal(s.hadir, 2);
  assert.equal(s.terlambat, 1);
  assert.equal(s.rataMasuk, '08:05');
});

test('CSV memakai titik koma dan meng-escape tanda kutip', () => {
  const csv = toCSV(['Nama', 'Catatan'], [['Rina', 'pakai "masker"; izin']]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('"pakai ""masker""; izin"'));
});

test('kedipan terdeteksi saat EAR turun lalu naik kembali', () => {
  const t = new BlinkTracker();
  let blink = false;
  const seq = [0.3, 0.31, 0.3, 0.3, 0.29, 0.18, 0.12, 0.2, 0.29, 0.3];
  seq.forEach((v, i) => { if (t.update(v, i * 60)) blink = true; });
  assert.equal(blink, true);
});

test('mata yang terus terbuka tidak dianggap kedip', () => {
  const t = new BlinkTracker();
  let blink = false;
  for (let i = 0; i < 40; i++) if (t.update(0.3 + (i % 3) * 0.005, i * 60)) blink = true;
  assert.equal(blink, false);
});

test('EAR dan utilitas kecil', () => {
  const eye = [{ x: 0, y: 0 }, { x: 1, y: -1 }, { x: 2, y: -1 }, { x: 3, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }];
  assert.ok(Math.abs(eyeAspectRatio(eye) - 2 / 3) < 1e-9);
  assert.equal(initials('Rina Kartika Sari'), 'RS');
  assert.equal(dateKey(new Date(2026, 0, 5)), '2026-01-05');
});
