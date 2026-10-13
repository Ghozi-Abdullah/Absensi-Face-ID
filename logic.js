// Logika murni absensi: tanpa DOM, bisa diuji di Node (logic.test.mjs, photo.test.mjs).

export const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const HARI_SINGKAT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
export const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export const DEFAULT_SETTINGS = {
  namaTempat: 'Kantor Saya',
  jamMasuk: '08:00',
  toleransi: 10,
  jamPulang: '17:00',
  jedaMinimal: 60,
  hariLibur: [0],
  ambang: 0.5,
  suara: 'bip',
  sheetsUrl: '',
  pinHash: ''
};

// Aturan pencocokan, hasil uji 19 wajah dengan kacamata sintetis:
// - margin: wajah harus jelas lebih mirip ke satu karyawan daripada karyawan lain
// - augPenalty: sampel kacamata sintetis dihitung sedikit lebih jauh, supaya orang lain
//   yang kebetulan berkacamata tidak ikut terasa "mirip"
// - frames: jumlah frame berturut-turut yang harus cocok ke orang yang sama
export const MATCH = { margin: 0.06, augPenalty: 0.06, frames: 3 };
export const LIMITS = { real: 10, live: 4 };

const pad = (n) => String(n).padStart(2, '0');

export function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Untuk file CSV (Excel membaca titik dua sebagai jam).
export function hhmm(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Untuk tampilan: penulisan jam baku bahasa Indonesia memakai titik (07.58).
export function jam(d) {
  return `${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

export function titik(hhmmText) {
  return hhmmText ? String(hhmmText).replace(':', '.') : hhmmText;
}

export function minutesOf(text) {
  const [h, m] = String(text || '00:00').split(/[:.]/).map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesOfDate(d) {
  return d.getHours() * 60 + d.getMinutes();
}

export function formatTanggal(d) {
  return `${NAMA_HARI[d.getDay()]}, ${d.getDate()} ${NAMA_BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDurasi(menit) {
  if (menit == null || !isFinite(menit)) return '—';
  const m = Math.max(0, Math.round(menit));
  return `${Math.floor(m / 60)} j ${pad(m % 60)} m`;
}

export function sapaan(d) {
  const h = d.getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

// ---------- Pencocokan wajah ----------

export function euclidean(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

const minDist = (d, list) => {
  let best = Infinity;
  for (const s of list || []) best = Math.min(best, euclidean(d, s));
  return best;
};

// Jarak ke satu karyawan. "plain" = ke sampel wajah asli (kamera, foto, dan yang dipelajari).
export function personDistance(descriptor, person, augPenalty = MATCH.augPenalty) {
  const plain = Math.min(minDist(descriptor, person.descriptors), minDist(descriptor, person.live));
  const aug = minDist(descriptor, person.augmented) + augPenalty;
  return { distance: Math.min(plain, aug), plain };
}

export function rankPeople(descriptor, people, augPenalty = MATCH.augPenalty) {
  return people
    .map((person) => ({ person, ...personDistance(descriptor, person, augPenalty) }))
    .sort((a, b) => a.distance - b.distance);
}

// Keputusan akhir: cocok ke satu orang, tidak dikenal, atau ragu antara dua orang.
export function matchFace(descriptor, people, { ambang = 0.5, margin = MATCH.margin, augPenalty = MATCH.augPenalty } = {}) {
  const ranked = rankPeople(descriptor, people, augPenalty);
  if (!ranked.length) return { person: null, reason: 'kosong', distance: Infinity };
  const [best, second] = ranked;
  if (best.distance > ambang) return { person: null, reason: 'asing', distance: best.distance };
  const gap = second ? second.distance - best.distance : Infinity;
  if (gap < margin) return { person: null, reason: 'ragu', distance: best.distance, candidates: [best.person, second.person] };
  return { person: best.person, distance: best.distance, plain: best.plain, margin: gap };
}

// Pencarian sederhana ke sampel asli, dipakai untuk mendeteksi wajah ganda saat mendaftar.
export function bestMatch(descriptor, people, ambang = 0.5) {
  let best = null;
  let bestDist = Infinity;
  for (const p of people) {
    const d = Math.min(minDist(descriptor, p.descriptors), minDist(descriptor, p.live));
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (best && bestDist <= ambang) return { person: best, distance: bestDist };
  return { person: null, distance: bestDist };
}

// Skor keyakinan 0-100 dari jarak, untuk ditampilkan ke pengguna.
export function confidence(distance, ambang = 0.5) {
  if (!isFinite(distance)) return 0;
  const c = 1 - distance / (ambang * 1.6);
  return Math.round(Math.max(0, Math.min(1, c)) * 100);
}

// Wajah dari kamera dipelajari bila kecocokannya jelas (selisih besar dengan karyawan lain)
// dan penampilannya berbeda dari sampel yang sudah ada, misalnya karena kacamata atau potongan rambut.
export function shouldLearn({ distance, plain, margin, ambang = 0.5 }) {
  if (!isFinite(distance)) return false;
  // Dengan satu karyawan saja tidak ada pembanding, jadi syarat jaraknya lebih ketat.
  const tegas = margin === Infinity ? distance <= ambang - 0.08 : margin >= 0.1 && distance <= ambang - 0.02;
  return tegas && plain > 0.22;
}

export function addLive(person, descriptor, max = LIMITS.live) {
  return [...(person.live || []), descriptor].slice(-max);
}

// ---------- Pendaftaran dari foto ----------

// Jarak terbesar antar-foto. Di atas ~0,6 biasanya foto-foto itu bukan orang yang sama.
export function maxPairDistance(descriptors) {
  let max = 0;
  for (let i = 0; i < descriptors.length; i++) {
    for (let j = i + 1; j < descriptors.length; j++) {
      max = Math.max(max, euclidean(descriptors[i], descriptors[j]));
    }
  }
  return max;
}

// Status satu foto berdasarkan wajah yang ditemukan di dalamnya.
export function photoVerdict(faces, minFacePx = 70) {
  if (!faces.length) return { status: 'none', pesan: 'Wajah tidak terdeteksi' };
  const largest = faces.reduce((a, b) => (b.box.width * b.box.height > a.box.width * a.box.height ? b : a));
  if (largest.box.width < minFacePx) return { status: 'small', pesan: 'Wajah terlalu kecil', face: largest };
  if (faces.length > 1) return { status: 'ok', pesan: `${faces.length} wajah, dipakai yang terbesar`, face: largest, warn: true };
  return { status: 'ok', pesan: 'Wajah terdeteksi', face: largest };
}

// ---------- Aturan absen ----------

// Menentukan aksi untuk satu orang berdasarkan log hari ini.
export function decideAction(logsHariIni, now, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const masuk = logsHariIni.find((l) => l.type === 'masuk');
  const pulang = logsHariIni.find((l) => l.type === 'pulang');
  const nowMin = minutesOfDate(now);

  if (!masuk) {
    const batas = minutesOf(s.jamMasuk) + Number(s.toleransi);
    const telat = nowMin > batas;
    return {
      type: 'masuk',
      status: telat ? 'terlambat' : 'tepat',
      telatMenit: telat ? nowMin - minutesOf(s.jamMasuk) : 0
    };
  }
  if (pulang) return { type: 'selesai', masuk, pulang };

  const sejakMasuk = (now.getTime() - new Date(masuk.time).getTime()) / 60000;
  if (sejakMasuk < Number(s.jedaMinimal)) {
    return { type: 'jeda', masuk, tungguMenit: Math.ceil(Number(s.jedaMinimal) - sejakMasuk) };
  }
  const awal = nowMin < minutesOf(s.jamPulang);
  return { type: 'pulang', status: awal ? 'pulang-awal' : 'normal' };
}

// ---------- Rekap ----------

// Gabungkan log menjadi satu baris per orang per tanggal.
export function buildRows(logs, people, from, to) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const map = new Map();
  for (const l of logs) {
    if (from && l.date < from) continue;
    if (to && l.date > to) continue;
    const key = `${l.date}|${l.personId}`;
    if (!map.has(key)) {
      const p = byId.get(l.personId);
      map.set(key, {
        date: l.date,
        personId: l.personId,
        name: p ? p.name : l.name,
        code: p ? p.code : (l.code || ''),
        division: p ? p.division : (l.division || ''),
        masuk: null,
        pulang: null,
        status: '',
        pulangAwal: false,
        durasi: null
      });
    }
    const row = map.get(key);
    if (l.type === 'masuk' && (!row.masuk || l.time < row.masuk)) {
      row.masuk = l.time;
      row.status = l.status;
    }
    if (l.type === 'pulang' && (!row.pulang || l.time > row.pulang)) {
      row.pulang = l.time;
      row.pulangAwal = l.status === 'pulang-awal';
    }
  }
  const rows = [...map.values()];
  for (const r of rows) {
    if (r.masuk && r.pulang) r.durasi = (new Date(r.pulang) - new Date(r.masuk)) / 60000;
  }
  rows.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, 'id') : b.date.localeCompare(a.date)));
  return rows;
}

export function summarize(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.personId)) {
      map.set(r.personId, { personId: r.personId, name: r.name, code: r.code, division: r.division, hadir: 0, terlambat: 0, pulangAwal: 0, totalMenit: 0, _masukMenit: [] });
    }
    const s = map.get(r.personId);
    if (r.masuk) {
      s.hadir += 1;
      s._masukMenit.push(minutesOfDate(new Date(r.masuk)));
    }
    if (r.status === 'terlambat') s.terlambat += 1;
    if (r.pulangAwal) s.pulangAwal += 1;
    if (r.durasi) s.totalMenit += r.durasi;
  }
  return [...map.values()].map((s) => {
    const avg = s._masukMenit.length ? s._masukMenit.reduce((a, b) => a + b, 0) / s._masukMenit.length : null;
    const { _masukMenit, ...rest } = s;
    const r = avg == null ? null : Math.round(avg);
    return { ...rest, rataMasuk: r == null ? null : `${pad(Math.floor(r / 60))}:${pad(r % 60)}` };
  }).sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

// Lembar hadir: satu baris per karyawan, satu kolom per tanggal.
// H = hadir tepat waktu, T = terlambat, A = tidak hadir di hari kerja, L = hari libur, '' = belum terjadi.
export const MAX_SHEET_DAYS = 62;

export function buildSheet(rows, people, from, to, hariLibur = [0], today = dateKey(new Date())) {
  const dates = [];
  for (let d = parseDateKey(from); dateKey(d) <= to && dates.length < MAX_SHEET_DAYS; d.setDate(d.getDate() + 1)) {
    dates.push({ key: dateKey(d), day: d.getDate(), dow: d.getDay(), libur: hariLibur.includes(d.getDay()) });
  }
  const byKey = new Map(rows.map((r) => [`${r.personId}|${r.date}`, r]));
  const roster = new Map(people.map((p) => [p.id, { id: p.id, name: p.name, since: p.createdAt ? dateKey(new Date(p.createdAt)) : '' }]));
  for (const r of rows) if (!roster.has(r.personId)) roster.set(r.personId, { id: r.personId, name: r.name, since: '' });
  const list = [...roster.values()].sort((a, b) => a.name.localeCompare(b.name, 'id')).map((p) => {
    const cells = [];
    let H = 0, T = 0, A = 0;
    for (const d of dates) {
      const r = byKey.get(`${p.id}|${d.key}`);
      let v = '';
      if (r && r.masuk) v = r.status === 'terlambat' ? 'T' : 'H';
      else if (d.libur) v = 'L';
      else if (d.key > today || (p.since && d.key < p.since)) v = '';
      else if (d.key === today) v = '';
      else v = 'A';
      if (v === 'H') H++;
      if (v === 'T') T++;
      if (v === 'A') A++;
      cells.push({ v, row: r || null });
    }
    return { ...p, cells, H, T, A };
  });
  const last = dates[dates.length - 1];
  return { dates, people: list, truncated: !!last && dates.length >= MAX_SHEET_DAYS && last.key < to };
}

// CSV dengan pemisah titik koma agar langsung rapi di Excel berbahasa Indonesia.
export function toCSV(header, rows, sep = ';') {
  const esc = (v) => {
    const t = v == null ? '' : String(v);
    return /[";\n,]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(sep)).join('\r\n');
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Warna avatar tetap untuk tiap nama.
export function hue(name, n = 6) {
  let h = 0;
  for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % n;
}

export function uid() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
