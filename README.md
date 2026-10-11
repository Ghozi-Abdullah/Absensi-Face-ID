<div align="center">

# Hadir

**Absensi wajah untuk usaha kecil. Cukup tablet atau laptop berkamera.**

[**Coba sekarang →**](https://ghozi-abdullah.github.io/Absensi-Face-ID/)

</div>

![Layar absen Hadir](docs/layar-absen.png)

Hadir mengubah perangkat yang sudah kamu punya menjadi mesin absensi. Karyawan cukup menatap kamera dan berkedip, lalu jam masuk, status terlambat, dan jam pulang tercatat sendiri. Di akhir bulan, rekapnya sudah siap untuk penggajian.

Dibuat untuk kedai, bengkel, klinik, toko, dan kantor kecil yang selama ini mencatat absensi di buku atau grup WhatsApp, dan tidak ingin membeli mesin fingerprint jutaan rupiah.

## Kenapa Hadir

**Tidak bisa titip absen.** Wajah dicocokkan dengan karyawan yang terdaftar, dan setiap absen harus disertai kedipan mata. Foto di layar HP tidak akan lolos.

**Data wajah tidak keluar dari perangkat.** Pengenalan wajah berjalan langsung di browser. Tidak ada foto yang disimpan, dan tidak ada data wajah yang dikirim ke server mana pun.

**Tetap jalan saat internet mati.** Hadir bisa dipasang di layar utama tablet seperti aplikasi biasa dan terus mencatat absen tanpa koneksi.

**Gratis dan tanpa server.** Cukup buka di browser. Tidak ada biaya langganan, tidak ada akun yang perlu dibuat.

## Fitur

### Absen dalam hitungan detik
Bingkai wajah berubah warna sesuai hasilnya: hijau untuk tepat waktu, kuning untuk terlambat, merah untuk wajah yang tidak dikenal. Karyawan disapa dengan namanya ("Selamat pagi, Rina"), lengkap dengan jam masuk dan tingkat kecocokan. Daftar siapa saja yang sudah hadir hari ini selalu terlihat di samping kamera.

### Daftar karyawan lewat kamera atau foto
Rekam 5 sampel wajah langsung di depan kamera, atau unggah 1–5 foto seperti pas foto dan foto KTP. Foto yang buram, tanpa wajah, atau berisi beberapa orang langsung ditandai. Karyawan yang didaftarkan dari foto akan makin mudah dikenali setiap kali ia absen.

### Rekap siap untuk penggajian
Lihat jumlah kehadiran, keterlambatan, pulang lebih awal, rata-rata jam masuk, dan total jam kerja per karyawan, untuk rentang tanggal mana pun. Rekap bisa diunduh sebagai CSV yang siap dibuka di Excel atau Google Sheets.

### Tersambung ke Google Sheets
Setiap absen bisa otomatis masuk ke Google Sheet sebagai satu baris baru, jadi pemilik usaha bisa memantau dari HP di mana saja. Absen yang tercatat saat offline dikirim begitu koneksi kembali.

### Aman ditinggal di meja depan
Kunci menu admin dengan PIN supaya karyawan hanya bisa mengakses layar absen. Atur jam masuk, toleransi keterlambatan, dan jam pulang sesuai aturan tempat kerjamu.

<table>
  <tr>
    <td><img src="docs/layar-karyawan.png" alt="Daftar karyawan"></td>
    <td><img src="docs/layar-rekap.png" alt="Rekap kehadiran"></td>
  </tr>
  <tr>
    <td align="center">Daftar karyawan</td>
    <td align="center">Rekap kehadiran</td>
  </tr>
</table>

## Privasi

Hadir dirancang mengikuti UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi. Setiap pendaftaran wajah meminta persetujuan karyawan. Foto hanya dibaca untuk diubah menjadi kode wajah, lalu dibuang. Yang dikirim ke Google Sheets hanya nama, ID, divisi, waktu, dan status. Data karyawan yang keluar bisa dihapus kapan saja.

## Dibangun dengan

TensorFlow.js · face-api · JavaScript · IndexedDB · Progressive Web App · GitHub Pages

---

<div align="center">

Dibuat oleh [Ghozi Abdullah](https://github.com/Ghozi-Abdullah) · Proyek Hari 1 dari **#30Hari30Website**

Lisensi MIT · Pengenalan wajah oleh [face-api](https://github.com/vladmandic/face-api) dan [TensorFlow.js](https://github.com/tensorflow/tfjs)

</div>
