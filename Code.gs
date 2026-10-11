/**
 * Penerima log absensi dari aplikasi Hadir.
 * Cara pakai ada di README bagian "Sinkron ke Google Sheets".
 * Hanya nama, ID, waktu, dan status yang diterima. Data wajah tidak pernah dikirim.
 */
const SHEET_NAME = 'Absensi';
const HEADER = ['ID log', 'Diterima', 'Tempat', 'Tanggal', 'Jam', 'Nama', 'ID karyawan', 'Divisi', 'Jenis', 'Status', 'Waktu ISO'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getSheet_();
    // Abaikan kiriman ganda (aplikasi mengirim ulang log yang belum pasti terkirim).
    const ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat() : [];
    if (ids.indexOf(data.id) === -1) {
      sheet.appendRow([
        data.id, new Date(), data.tempat, data.tanggal, data.jam, data.nama,
        data.idKaryawan, data.divisi, data.jenis, data.status, data.waktuISO
      ]);
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json_({ ok: true, info: 'Endpoint absensi Hadir aktif. Gunakan POST.' });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADER.length).setFontWeight('bold');
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
