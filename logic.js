// Logika murni absensi: tanpa DOM, bisa diuji di Node (lihat tests/).

export const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export const DEFAULT_SETTINGS = {
  namaTempat: 'Kantor Saya',
  jamMasuk: '08:00',
  toleransi: 10,
  jamPulang: '17:00',
  jedaMinimal: 60,
  ambang: 0.5,
  wajibKedip: true,
  suara: 'bip',
  sheetsUrl: '',
  pinHash: ''
};

const pad = (n) => String(n).padStart(2, '0');

export function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hhmm(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function minutesOf(text) {
  const [h, m] = String(text || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesOfDate(d) {
  return d.getHours() * 60 + d.getMinutes();
}

export function formatTanggal(d) {
  return `${NAMA_HARI[d.getDay()]}, ${d.getDate()} ${NAMA_BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDurasi(menit) {
  if (menit == null || !isFinite(menit)) return '-';
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

// Cari orang dengan sampel wajah terdekat. Jarak <= ambang dianggap cocok.
export function bestMatch(descriptor, people, ambang = 0.5) {
  let best = null;
  let bestDist = Infinity;
  for (const p of people) {
    for (const s of p.descriptors || []) {
      const d = euclidean(descriptor, s);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
  }
  if (best && bestDist <= ambang) return { person: best, distance: bestDist };
  return { person: null, distance: bestDist };
}

// ---------- Pendaftaran dari foto ----------

export const MAX_SAMPLES = 8;

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

// Karyawan yang didaftarkan dari foto "belajar" dari wajah aslinya di kamera:
// sampel kamera ditambahkan hanya bila cocoknya meyakinkan, sampai MAX_SAMPLES.
export function shouldLearn(person, distance, ambang, max = MAX_SAMPLES) {
  if (!person || person.source !== 'foto') return false;
  if ((person.descriptors || []).length >= max) return false;
  return distance <= Number(ambang) - 0.05;
}

// Status satu foto berdasarkan wajah yang ditemukan di dalamnya.
export function photoVerdict(faces, minFacePx = 70) {
  if (!faces.length) return { status: 'none', pesan: 'Wajah tidak terdeteksi' };
  const largest = faces.reduce((a, b) => (b.box.width * b.box.height > a.box.width * a.box.height ? b : a));
  if (largest.box.width < minFacePx) return { status: 'small', pesan: 'Wajah terlalu kecil, pakai foto yang lebih dekat', face: largest };
  if (faces.length > 1) return { status: 'ok', pesan: `${faces.length} wajah, dipakai yang terbesar`, face: largest, warn: true };
  return { status: 'ok', pesan: 'Wajah terdeteksi', face: largest };
}

// Skor keyakinan 0-100 dari jarak, untuk ditampilkan ke pengguna.
export function confidence(distance, ambang = 0.5) {
  if (!isFinite(distance)) return 0;
  const c = 1 - distance / (ambang * 1.6);
  return Math.round(Math.max(0, Math.min(1, c)) * 100);
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

// CSV dengan pemisah titik koma agar langsung rapi di Excel berbahasa Indonesia.
export function toCSV(header, rows, sep = ';') {
  const esc = (v) => {
    const t = v == null ? '' : String(v);
    return /[";\n,]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(sep)).join('\r\n');
}

// ---------- Deteksi kedip (anti-foto) ----------

// Eye Aspect Ratio dari 6 titik mata (urutan landmark 68 titik).
export function eyeAspectRatio(eye) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const w = d(eye[0], eye[3]);
  if (!w) return 0;
  return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * w);
}

// Melacak satu kedipan: mata terbuka -> tertutup -> terbuka lagi.
// Ambang dihitung relatif terhadap mata terbuka orang itu sendiri.
export class BlinkTracker {
  constructor({ closeRatio = 0.74, openRatio = 0.88, maxClosedMs = 900 } = {}) {
    this.closeRatio = closeRatio;
    this.openRatio = openRatio;
    this.maxClosedMs = maxClosedMs;
    this.reset();
  }

  reset() {
    this.baseline = 0;
    this.samples = 0;
    this.closedAt = 0;
    this.state = 'open';
  }

  update(ear, t) {
    if (!ear) return false;
    if (this.state === 'open') {
      this.baseline = this.samples === 0 ? ear : Math.max(ear, this.baseline * 0.985 + ear * 0.015);
      this.samples += 1;
      if (this.samples >= 3 && ear < this.baseline * this.closeRatio) {
        this.state = 'closed';
        this.closedAt = t;
      }
      return false;
    }
    if (ear > this.baseline * this.openRatio) {
      const lama = t - this.closedAt;
      this.state = 'open';
      return lama <= this.maxClosedMs;
    }
    if (t - this.closedAt > this.maxClosedMs * 3) this.state = 'open';
    return false;
  }
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function uid() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
