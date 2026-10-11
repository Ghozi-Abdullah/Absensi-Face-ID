# Hadir · Absensi Wajah di Browser

Absensi karyawan dengan pengenalan wajah, cukup memakai laptop atau tablet berkamera. Tidak perlu mesin fingerprint, server, atau langganan. Data wajah tersimpan di perangkat itu sendiri, dan rekap bisa diekspor ke CSV atau dikirim otomatis ke Google Sheets.

**Demo:** `https://USERNAME.github.io/absensi-face-id/` (ganti `USERNAME` setelah deploy)

![Layar absen](docs/layar-absen.png)

## Masalah yang diselesaikan

UMKM, kedai, bengkel, dan kantor kecil sering mencatat absensi di buku atau grup WhatsApp. Mesin fingerprint harganya jutaan rupiah dan rawan "titip absen". Hadir mengubah perangkat yang sudah ada menjadi mesin absensi:

- Karyawan cukup menghadap kamera, absen masuk atau pulang tercatat otomatis.
- Status tepat waktu, terlambat, dan pulang awal dihitung dari jam kerja yang kamu atur.
- Cek kedip mencegah absen memakai foto orang lain di layar HP.
- Pemilik usaha melihat rekap bulanan dan mengunduhnya sebagai CSV untuk penggajian.

## Fitur

| Menu | Isi |
| --- | --- |
| Absen | Kamera dengan bingkai wajah, jam besar, sapaan otomatis, status terlambat, daftar siapa saja yang sudah hadir hari ini |
| Karyawan | Daftar wajah dengan 5 sampel dari sudut berbeda, deteksi wajah ganda, hapus karyawan |
| Rekap | Filter tanggal dan karyawan, ringkasan per orang (hadir, terlambat, pulang awal, rata-rata jam masuk, total jam), log harian, ekspor CSV |
| Pengaturan | Jam masuk, toleransi, jam pulang, jeda minimal, ketelitian pencocokan, wajib kedip, suara sapaan, sinkron Google Sheets, PIN admin, cadangan dan pemulihan data |

Aplikasi ini juga PWA: bisa dipasang di layar utama tablet dan tetap berjalan saat internet putus. Log yang belum terkirim ke Google Sheets dikirim ulang saat koneksi kembali.

![Rekap](docs/layar-rekap.png)

## Cara kerja

1. **Deteksi wajah**: Tiny Face Detector menemukan wajah di frame kamera.
2. **68 titik wajah**: posisi mata, hidung, dan mulut dipakai untuk meluruskan wajah dan menghitung rasio bukaan mata (EAR) untuk cek kedip.
3. **Descriptor 128 angka**: wajah diubah menjadi vektor. Foto wajah tidak pernah disimpan, hanya angka ini.
4. **Pencocokan**: vektor dibandingkan dengan 5 sampel tiap karyawan memakai jarak Euclidean. Jarak di bawah ambang (bawaan 0,50) dianggap cocok, dan wajah harus cocok di dua frame berturut-turut.
5. **Aturan absen**: absen pertama hari itu = masuk; setelah jeda minimal = pulang; sesudahnya hanya ditampilkan ringkasan.
6. **Penyimpanan**: karyawan dan log disimpan di IndexedDB browser. Bila URL Google Sheets diisi, setiap log dikirim sebagai satu baris.

Model berjalan dengan TensorFlow.js. Backend yang dipakai otomatis: WebGL bila tersedia, lalu WebAssembly, lalu CPU.

## Privasi dan UU PDP

Data biometrik termasuk data pribadi yang bersifat spesifik menurut UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi. Karena itu:

- Form pendaftaran mewajibkan centang persetujuan karyawan.
- Data wajah (descriptor) hanya ada di browser perangkat absensi dan tidak pernah dikirim ke server mana pun.
- Yang dikirim ke Google Sheets hanya nama, ID, divisi, waktu, dan status.
- Karyawan yang keluar bisa dihapus beserta data wajahnya dari menu Karyawan.

## Deploy ke GitHub Pages

1. Buat repo baru di GitHub, misalnya `absensi-face-id`, lalu push isi folder ini ke branch `main`.
   ```bash
   git init
   git add .
   git commit -m "Hadir: absensi wajah"
   git branch -M main
   git remote add origin https://github.com/USERNAME/absensi-face-id.git
   git push -u origin main
   ```
2. Buka **Settings → Pages**, lalu pada **Build and deployment → Source** pilih **GitHub Actions**.
3. Workflow `.github/workflows/pages.yml` menjalankan tes lalu men-deploy. Setelah selesai (sekitar 1 menit), situs live di `https://USERNAME.github.io/absensi-face-id/`.

Kamera hanya bisa dipakai lewat HTTPS, dan GitHub Pages sudah HTTPS.

## Menjalankan di komputer sendiri

```bash
npm start          # menjalankan server statis di http://localhost:5173
# atau tanpa Node:
python3 -m http.server 5173
```

Buka `http://localhost:5173`. Browser menganggap `localhost` aman, jadi kamera bisa dipakai.

```bash
npm test           # 11 tes untuk aturan absen, pencocokan, rekap, CSV, dan deteksi kedip
```

## Sinkron ke Google Sheets (opsional)

1. Buat Google Sheet baru.
2. Buka **Ekstensi → Apps Script**, hapus isi bawaan, lalu tempel isi `apps-script/Code.gs`. Simpan.
3. Klik **Deploy → Deployment baru**, pilih jenis **Aplikasi web**.
   - Jalankan sebagai: **Saya**
   - Yang memiliki akses: **Siapa saja**
4. Klik **Deploy**, izinkan akses, lalu salin URL yang berakhiran `/exec`.
5. Di aplikasi Hadir, buka **Pengaturan → Sinkron ke Google Sheets**, tempel URL, lalu klik **Kirim baris tes**. Sheet bernama `Absensi` akan muncul dengan satu baris tes.

Script menolak baris ganda berdasarkan ID log, jadi pengiriman ulang saat koneksi kembali tidak membuat data dobel.

## Tips akurasi

- Daftarkan wajah di tempat yang sama dengan lokasi absen, dengan cahaya dari depan.
- Letakkan perangkat setinggi wajah, jarak sekitar 50 cm.
- Bila sering tertukar antar-karyawan, geser ketelitian ke kiri (misalnya 0,45). Bila sering tidak dikenali, geser ke kanan atau daftarkan ulang wajahnya.

## Keterbatasan yang perlu diketahui

- Cek kedip menahan foto diam, tetapi belum menahan video rekaman orang berkedip. Untuk keamanan lebih tinggi, pasang perangkat di tempat yang terlihat petugas.
- Data tersimpan per perangkat. Untuk pindah perangkat, pakai **Unduh cadangan** lalu **Pulihkan dari cadangan**.
- Shift yang melewati tengah malam belum didukung; absen pulang setelah pukul 00.00 terhitung hari berikutnya.

## Struktur folder

```
index.html              tampilan aplikasi
css/style.css           gaya, termasuk mode gelap dan tata letak HP
js/app.js               alur layar, kamera, rekap, pengaturan
js/logic.js             aturan absen, pencocokan, rekap, CSV, deteksi kedip (diuji)
js/face.js              pembungkus face-api
js/db.js                penyimpanan IndexedDB
js/sheets.js            pengiriman ke Google Apps Script
apps-script/Code.gs     penerima log di Google Sheets
models/                 bobot model wajah (6,9 MB)
vendor/face-api/        face-api + TensorFlow.js + file WASM
sw.js, manifest.webmanifest   PWA dan mode offline
tests/                  tes Node (node --test)
```

## Lisensi

MIT. Menggunakan [@vladmandic/face-api](https://github.com/vladmandic/face-api) (MIT) dan model dari [face-api.js](https://github.com/justadudewhohacks/face-api.js) (MIT), berjalan di atas [TensorFlow.js](https://github.com/tensorflow/tfjs) (Apache 2.0).

Bagian dari tantangan **#30Hari30Website** · Hari 1.
