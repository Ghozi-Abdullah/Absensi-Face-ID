import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideAction, bestMatch, matchFace, buildRows, summarize, buildSheet, toCSV,
  initials, confidence, dateKey, jam, titik, minutesOf
} from './logic.js';

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

const people = [
  { id: 'a', name: 'Rina', descriptors: [[0, 0, 0]], augmented: [[0.3, 0, 0]], live: [] },
  { id: 'b', name: 'Budi', descriptors: [[1, 1, 1]], augmented: [], live: [] }
];

test('pencocokan memilih orang terdekat dan menolak wajah asing', () => {
  assert.equal(matchFace([0.05, 0, 0], people, { ambang: 0.5 }).person.id, 'a');
  const asing = matchFace([0.5, 0.5, 0.5], people, { ambang: 0.3 });
  assert.equal(asing.person, null);
  assert.equal(asing.reason, 'asing');
  assert.ok(confidence(0.1) > confidence(0.4));
});

test('sampel kacamata sintetis dihitung dengan penalti', () => {
  // Wajah tepat di sampel kacamata: jarak 0 + penalti 0,06.
  const m = matchFace([0.3, 0, 0], people, { ambang: 0.5, augPenalty: 0.06 });
  assert.equal(m.person.id, 'a');
  assert.ok(Math.abs(m.distance - 0.06) < 1e-9);
  assert.ok(Math.abs(m.plain - 0.3) < 1e-9);
});

test('wajah yang sama-sama mirip dua karyawan ditolak sebagai ragu', () => {
  const kembar = [
    { id: 'a', name: 'Rina', descriptors: [[0, 0]] },
    { id: 'c', name: 'Rani', descriptors: [[0.04, 0]] }
  ];
  const m = matchFace([0.02, 0], kembar, { ambang: 0.5, margin: 0.06 });
  assert.equal(m.person, null);
  assert.equal(m.reason, 'ragu');
});

test('bestMatch hanya memakai sampel asli untuk cek wajah ganda', () => {
  assert.equal(bestMatch([0.3, 0, 0], people, 0.2).person, null);
  assert.equal(bestMatch([0.1, 0, 0], people, 0.2).person.id, 'a');
});

test('rekap menggabungkan masuk dan pulang per orang per hari', () => {
  const ppl = [{ id: 'a', name: 'Rina', code: 'K1', division: 'Dapur' }];
  const logs = [
    { personId: 'a', name: 'Rina', date: '2026-10-12', type: 'masuk', status: 'terlambat', time: at(8, 20).toISOString() },
    { personId: 'a', name: 'Rina', date: '2026-10-12', type: 'pulang', status: 'normal', time: at(17, 20).toISOString() },
    { personId: 'a', name: 'Rina', date: '2026-10-13', type: 'masuk', status: 'tepat', time: at(7, 50, 13).toISOString() }
  ];
  const rows = buildRows(logs, ppl, '2026-10-01', '2026-10-31');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.date === '2026-10-12').durasi, 540);
  const s = summarize(rows)[0];
  assert.equal(s.hadir, 2);
  assert.equal(s.terlambat, 1);
  assert.equal(s.rataMasuk, '08:05');
});

test('lembar hadir menandai H, T, A, dan hari libur', () => {
  const ppl = [{ id: 'a', name: 'Rina', createdAt: new Date(2026, 9, 1).toISOString() }];
  const logs = [
    { personId: 'a', name: 'Rina', date: '2026-10-05', type: 'masuk', status: 'tepat', time: at(7, 55, 5).toISOString() },
    { personId: 'a', name: 'Rina', date: '2026-10-06', type: 'masuk', status: 'terlambat', time: at(8, 30, 6).toISOString() }
  ];
  const rows = buildRows(logs, ppl, '2026-10-04', '2026-10-09');
  const sheet = buildSheet(rows, ppl, '2026-10-04', '2026-10-09', [0], '2026-10-08');
  const v = sheet.people[0].cells.map((c) => c.v).join('');
  // 4 Okt Minggu (libur), 5 H, 6 T, 7 A, 8 hari ini (kosong), 9 belum terjadi
  assert.equal(v, 'LHTA');
  assert.equal(sheet.dates.length, 6);
  assert.deepEqual([sheet.people[0].H, sheet.people[0].T, sheet.people[0].A], [1, 1, 1]);
});

test('jam tampil memakai titik sesuai ejaan bahasa Indonesia', () => {
  assert.equal(jam(at(7, 5)), '07.05');
  assert.equal(titik('08:30'), '08.30');
  assert.equal(minutesOf('08.30'), 510);
});

test('CSV memakai titik koma dan meng-escape tanda kutip', () => {
  const csv = toCSV(['Nama', 'Catatan'], [['Rina', 'pakai "masker"; izin']]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('"pakai ""masker""; izin"'));
});

test('utilitas kecil', () => {
  assert.equal(initials('Rina Kartika Sari'), 'RS');
  assert.equal(dateKey(new Date(2026, 0, 5)), '2026-01-05');
});
