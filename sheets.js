// Kirim log absensi ke Google Sheets lewat Google Apps Script (lihat Code.gs).
// Yang dikirim hanya nama, ID, waktu, dan status. Data wajah tetap di perangkat.

export async function sendLog(url, log, tempat) {
  if (!url) return false;
  const body = JSON.stringify({
    id: log.id,
    tempat,
    tanggal: log.date,
    jam: new Date(log.time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    waktuISO: log.time,
    nama: log.name,
    idKaryawan: log.code || '',
    divisi: log.division || '',
    jenis: log.type,
    status: log.status
  });
  // Apps Script tidak mengirim header CORS untuk POST, jadi permintaan dikirim
  // sebagai text/plain dengan mode no-cors. Responsnya tidak bisa dibaca,
  // tetapi baris tetap tercatat di Sheet.
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  });
  return true;
}

export async function sendTest(url, tempat) {
  const now = new Date();
  return sendLog(url, {
    id: 'tes-' + now.getTime(),
    date: now.toISOString().slice(0, 10),
    time: now.toISOString(),
    name: 'Tes koneksi',
    code: '-',
    division: '-',
    type: 'tes',
    status: 'tes'
  }, tempat);
}
