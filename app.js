import * as db from './db.js';
import * as face from './face.js';
import {
  DEFAULT_SETTINGS, dateKey, hhmm, formatTanggal, formatDurasi, sapaan, bestMatch, confidence,
  decideAction, buildRows, summarize, toCSV, BlinkTracker, initials, uid, minutesOfDate, NAMA_BULAN
} from './logic.js';
import { sendLog, sendTest } from './sheets.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

const ENROLL_SAMPLES = 5;
const ENROLL_STEPS = ['Tatap lurus ke kamera', 'Tengok sedikit ke kiri', 'Tengok sedikit ke kanan', 'Angkat dagu sedikit', 'Senyum tipis'];
const BLINK_WINDOW_MS = 7000;

const state = {
  settings: { ...DEFAULT_SETTINGS },
  people: [],
  todayLogs: [],
  today: dateKey(new Date()),
  view: 'absen',
  unlocked: false,
  stream: null,
  timer: null,
  mode: 'idle', // idle | blink | enroll
  pausedUntil: 0,
  candidate: null,
  candidateHits: 0,
  unknownHits: 0,
  blink: null,
  enroll: null,
  resultTimer: null,
  audio: null
};

const el = {
  videoAbsen: $('video-absen'),
  videoEnroll: $('video-enroll'),
  overlayAbsen: $('overlay-absen'),
  overlayEnroll: $('overlay-enroll'),
  camMsg: $('cam-msg'),
  camMsgText: $('cam-msg-text'),
  chip: $('model-chip'),
  chipText: $('model-chip-text'),
  result: $('result'),
  resultTitle: $('result-title'),
  resultSub: $('result-sub'),
  resultAvatar: $('result-avatar'),
  resultProgress: $('result-progress')
};
const AVATAR_ICON = el.resultAvatar.innerHTML;

// ---------------- Mulai ----------------

init();

async function init() {
  state.settings = await db.getSettings(DEFAULT_SETTINGS);
  state.people = await db.getAll('people');
  await refreshToday();
  applySettingsUI();
  fillSettingsForm();
  renderPeople();
  renderToday();
  startClock();
  bindNav();
  bindCamera();
  bindEnroll();
  bindRekap();
  bindSettings();
  bindModal();
  registerServiceWorker();
  loadModels();
  autoStartCamera();
  retryUnsynced();
  window.addEventListener('online', retryUnsynced);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(state.timer);
    else schedule(200);
  });
  if (!db.isPersistent()) {
    $('storage-note').textContent = 'Browser ini tidak mengizinkan penyimpanan permanen (mode privat?). Data akan hilang saat tab ditutup.';
  }
}

async function refreshToday() {
  state.today = dateKey(new Date());
  state.todayLogs = await db.logsByDate(state.today);
}

// ---------------- Jam ----------------

function startClock() {
  const tick = () => {
    const now = new Date();
    $('clock-time').textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\./g, ':');
    $('clock-date').textContent = formatTanggal(now);
    if (dateKey(now) !== state.today) refreshToday().then(renderToday);
  };
  tick();
  setInterval(tick, 1000);
}

// ---------------- Navigasi + PIN ----------------

function bindNav() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => go(btn.dataset.view));
  });
}

async function go(view) {
  if (view === state.view) return;
  if (view !== 'absen' && state.settings.pinHash && !state.unlocked) {
    const pin = await ask({ title: 'Masukkan PIN admin', body: 'Menu ini hanya untuk admin.', input: 'pin', okText: 'Buka', validate: async (v) => (await sha256(v)) === state.settings.pinHash ? '' : 'PIN salah. Coba lagi.' });
    if (pin == null) return;
    state.unlocked = true;
  }
  if (view === 'absen') state.unlocked = false;
  if (state.mode === 'enroll' && view !== 'karyawan') cancelEnroll();
  state.view = view;
  document.querySelectorAll('.view').forEach((s) => { s.hidden = s.dataset.view !== view; });
  document.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (view === 'rekap') renderRekap();
  if (view === 'absen') { el.videoAbsen.play().catch(() => {}); resetResult(); }
  schedule(100);
}

// ---------------- Kamera ----------------

function bindCamera() {
  $('btn-start-cam').addEventListener('click', () => { unlockAudio(); startCamera(); });
}

async function autoStartCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    el.camMsgText.textContent = 'Kamera hanya bisa dipakai lewat HTTPS (misalnya GitHub Pages) atau localhost.';
    $('btn-start-cam').hidden = true;
    return;
  }
  try {
    const p = await navigator.permissions?.query({ name: 'camera' });
    if (p && p.state === 'granted') startCamera();
  } catch (e) { /* browser tidak mendukung query izin kamera */ }
}

async function startCamera() {
  if (state.stream) return true;
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
      audio: false
    });
    el.videoAbsen.srcObject = state.stream;
    el.videoEnroll.srcObject = state.stream;
    await el.videoAbsen.play().catch(() => {});
    el.camMsg.hidden = true;
    schedule(300);
    return true;
  } catch (err) {
    const pesan = {
      NotAllowedError: 'Akses kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser, lalu muat ulang halaman.',
      NotFoundError: 'Kamera tidak ditemukan. Sambungkan webcam lalu coba lagi.',
      NotReadableError: 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.'
    }[err.name] || `Kamera gagal dinyalakan (${err.name || err.message}).`;
    el.camMsgText.textContent = pesan;
    el.camMsg.hidden = false;
    return false;
  }
}

async function loadModels() {
  try {
    await face.loadModels('./models');
    el.chip.classList.add('ready');
    el.chipText.textContent = 'Siap memindai';
    schedule(100);
  } catch (err) {
    console.error(err);
    el.chipText.textContent = 'Model wajah gagal dimuat. Muat ulang halaman.';
  }
}

// ---------------- Loop deteksi ----------------

function schedule(ms) {
  clearTimeout(state.timer);
  state.timer = setTimeout(loop, ms);
}

async function loop() {
  if (document.hidden) return;
  if (!face.isReady() || !state.stream) return schedule(400);
  const enrolling = state.mode === 'enroll' && state.view === 'karyawan';
  if (!enrolling && state.view !== 'absen') return schedule(600);
  const video = enrolling ? el.videoEnroll : el.videoAbsen;
  if (video.paused) video.play().catch(() => {});
  if (video.readyState < 2) return schedule(200);
  try {
    if (enrolling) await enrollTick(video);
    else if (state.mode === 'blink') await blinkTick(video);
    else await kioskTick(video);
  } catch (err) {
    console.error(err);
  }
  schedule(state.mode === 'blink' ? 20 : 150);
}

function drawBox(canvas, video, f, color) {
  const w = video.videoWidth, h = video.videoHeight;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!f) return;
  const { x, y, width, height } = f.box;
  const pad = width * 0.12;
  const bx = x - pad, by = y - pad * 1.4, bw = width + pad * 2, bh = height + pad * 2.2;
  const r = Math.min(bw, bh) * 0.14;
  const c = Math.min(bw, bh) * 0.24;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, w / 220);
  ctx.lineCap = 'round';
  ctx.beginPath();
  // sudut kiri atas
  ctx.moveTo(bx, by + c); ctx.lineTo(bx, by + r); ctx.quadraticCurveTo(bx, by, bx + r, by); ctx.lineTo(bx + c, by);
  // kanan atas
  ctx.moveTo(bx + bw - c, by); ctx.lineTo(bx + bw - r, by); ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r); ctx.lineTo(bx + bw, by + c);
  // kanan bawah
  ctx.moveTo(bx + bw, by + bh - c); ctx.lineTo(bx + bw, by + bh - r); ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh); ctx.lineTo(bx + bw - c, by + bh);
  // kiri bawah
  ctx.moveTo(bx + c, by + bh); ctx.lineTo(bx + r, by + bh); ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r); ctx.lineTo(bx, by + bh - c);
  ctx.stroke();
}

const COLOR = { scan: '#FFFFFF', ok: '#4ADE80', warn: '#FBBF24', bad: '#F87171', blink: '#8C98FF' };

async function kioskTick(video) {
  const paused = Date.now() < state.pausedUntil;
  const f = await face.readFace(video);
  if (paused) {
    drawBox(el.overlayAbsen, video, f, COLOR[el.result.dataset.state === 'bad' ? 'bad' : el.result.dataset.state === 'late' ? 'warn' : 'ok']);
    return;
  }
  drawBox(el.overlayAbsen, video, f, COLOR.scan);
  if (!f) {
    state.candidate = null; state.candidateHits = 0; state.unknownHits = 0;
    if (!state.resultTimer) resetResult();
    return;
  }
  if (!state.people.length) {
    setResult('info', 'Belum ada karyawan terdaftar', 'Daftarkan wajah karyawan di menu Karyawan.');
    return;
  }
  if (f.sizeRatio < 0.16) {
    setResult('info', 'Mendekat sedikit', 'Wajah terlalu kecil. Jarak ideal sekitar 50 cm.');
    return;
  }
  const m = bestMatch(f.descriptor, state.people, Number(state.settings.ambang));
  if (!m.person) {
    state.candidate = null; state.candidateHits = 0;
    state.unknownHits += 1;
    if (state.unknownHits >= 4) {
      state.unknownHits = 0;
      setResult('bad', 'Wajah tidak dikenali', 'Pastikan sudah terdaftar dan pencahayaan cukup terang.', 2600);
      state.pausedUntil = Date.now() + 2000;
    }
    return;
  }
  state.unknownHits = 0;
  if (state.candidate && state.candidate.id === m.person.id) state.candidateHits += 1;
  else { state.candidate = m.person; state.candidateHits = 1; }
  if (state.candidateHits < 2) return;

  const person = m.person;
  state.candidate = null; state.candidateHits = 0;
  const now = new Date();
  const action = decideAction(state.todayLogs.filter((l) => l.personId === person.id), now, state.settings);

  if (action.type === 'jeda') {
    setResult('info', `${firstName(person.name)}, absen masuk sudah tercatat`, `Masuk ${hhmm(new Date(action.masuk.time))}. Absen pulang bisa dilakukan ${action.tungguMenit} menit lagi.`, 3800, person);
    state.pausedUntil = Date.now() + 3800;
    return;
  }
  if (action.type === 'selesai') {
    setResult('info', `${firstName(person.name)}, absen hari ini sudah lengkap`, `Masuk ${hhmm(new Date(action.masuk.time))} · pulang ${hhmm(new Date(action.pulang.time))}`, 3800, person);
    state.pausedUntil = Date.now() + 3800;
    return;
  }
  if (state.settings.wajibKedip) {
    state.mode = 'blink';
    state.blink = { person, action, until: Date.now() + BLINK_WINDOW_MS, tracker: new BlinkTracker() };
    setResult('blink', `Halo ${firstName(person.name)}, kedipkan mata`, 'Kedip sekali dengan pelan untuk memastikan ini bukan foto.', BLINK_WINDOW_MS, person, true);
    return;
  }
  await record(person, action, m.distance);
}

async function blinkTick(video) {
  const b = state.blink;
  if (!b) { state.mode = 'idle'; return; }
  if (Date.now() > b.until) {
    state.mode = 'idle'; state.blink = null;
    setResult('bad', 'Kedipan tidak terdeteksi', 'Tatap kamera, lalu kedip pelan sekali. Silakan coba lagi.', 3000);
    state.pausedUntil = Date.now() + 2200;
    return;
  }
  const f = await face.readLandmarks(video);
  drawBox(el.overlayAbsen, video, f, COLOR.blink);
  if (!f) return;
  if (b.tracker.update(f.ear, performance.now())) {
    // Pastikan wajah yang berkedip masih orang yang sama.
    const check = await face.readFace(video);
    state.mode = 'idle'; state.blink = null;
    if (check) {
      const m = bestMatch(check.descriptor, state.people, Number(state.settings.ambang));
      if (m.person && m.person.id === b.person.id) {
        await record(b.person, b.action, m.distance);
        return;
      }
    }
    setResult('bad', 'Wajah berubah saat verifikasi', 'Ulangi dari awal dengan satu orang di depan kamera.', 2800);
    state.pausedUntil = Date.now() + 2000;
  }
}

async function record(person, action, distance) {
  const now = new Date();
  const log = {
    id: uid(),
    personId: person.id,
    name: person.name,
    code: person.code || '',
    division: person.division || '',
    date: dateKey(now),
    type: action.type,
    status: action.status,
    time: now.toISOString(),
    distance: Number(distance.toFixed(3)),
    synced: false
  };
  await db.put('logs', log);
  if (log.date === state.today) state.todayLogs.push(log);
  else await refreshToday();
  renderToday();

  const nama = firstName(person.name);
  const jam = hhmm(now);
  const yakin = confidence(distance, Number(state.settings.ambang));
  if (action.type === 'masuk') {
    if (action.status === 'terlambat') setResult('late', `${sapaan(now)}, ${nama}`, `Masuk ${jam} · terlambat ${action.telatMenit} menit · cocok ${yakin}%`, 4200, person);
    else setResult('ok', `${sapaan(now)}, ${nama}`, `Masuk ${jam} · tepat waktu · cocok ${yakin}%`, 4200, person);
  } else {
    const masuk = state.todayLogs.find((l) => l.personId === person.id && l.type === 'masuk');
    const durasi = masuk ? formatDurasi((now - new Date(masuk.time)) / 60000) : '-';
    if (action.status === 'pulang-awal') setResult('late', `Pulang lebih awal, ${nama}`, `Pulang ${jam} · kerja ${durasi}`, 4200, person);
    else setResult('ok', `Hati-hati di jalan, ${nama}`, `Pulang ${jam} · kerja ${durasi}`, 4200, person);
  }
  feedback(action.type === 'masuk' ? `${sapaan(now)}, ${nama}` : `Hati-hati di jalan, ${nama}`);
  state.pausedUntil = Date.now() + 4200;
  syncOne(log);
}

// ---------------- Panel hasil ----------------

function setResult(kind, title, sub, durationMs, person, keepProgress) {
  clearTimeout(state.resultTimer);
  state.resultTimer = null;
  el.result.dataset.state = kind;
  el.resultTitle.textContent = title;
  el.resultSub.textContent = sub || '';
  if (person) el.resultAvatar.textContent = initials(person.name);
  else el.resultAvatar.innerHTML = AVATAR_ICON;
  const bar = el.resultProgress;
  bar.style.transition = 'none';
  bar.style.width = durationMs ? '100%' : '0';
  if (durationMs) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.transition = `width ${durationMs}ms linear`;
      bar.style.width = '0';
    }));
    state.resultTimer = setTimeout(() => {
      state.resultTimer = null;
      if (state.mode !== 'blink' || !keepProgress) resetResult();
    }, durationMs);
  }
}

function resetResult() {
  if (state.mode === 'blink') return;
  clearTimeout(state.resultTimer);
  state.resultTimer = null;
  el.result.dataset.state = 'idle';
  el.resultTitle.textContent = 'Hadapkan wajah ke kamera';
  el.resultSub.textContent = 'Jarak sekitar 50 cm, wajah terlihat jelas tanpa masker.';
  el.resultAvatar.innerHTML = AVATAR_ICON;
  el.resultProgress.style.transition = 'none';
  el.resultProgress.style.width = '0';
}

// ---------------- Suara ----------------

function unlockAudio() {
  if (state.audio) return;
  try { state.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { state.audio = null; }
}
document.addEventListener('pointerdown', unlockAudio, { once: true });

function feedback(kalimat) {
  const mode = state.settings.suara;
  if (mode === 'mati') return;
  if (mode === 'sapaan' && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(kalimat);
    u.lang = 'id-ID';
    u.rate = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return;
  }
  const ctx = state.audio;
  if (!ctx) return;
  const t = ctx.currentTime;
  [880, 1320].forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t + i * 0.12);
    g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.12 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(t + i * 0.12);
    o.stop(t + i * 0.12 + 0.2);
  });
}

// ---------------- Hari ini ----------------

function renderToday() {
  const logs = state.todayLogs;
  const masuk = logs.filter((l) => l.type === 'masuk');
  const hadirIds = new Set(masuk.map((l) => l.personId));
  $('today-count').textContent = `${hadirIds.size} dari ${state.people.length} hadir`;
  $('st-tepat').textContent = masuk.filter((l) => l.status === 'tepat').length;
  $('st-telat').textContent = masuk.filter((l) => l.status === 'terlambat').length;
  $('st-pulang').textContent = new Set(logs.filter((l) => l.type === 'pulang').map((l) => l.personId)).size;
  const feed = $('feed');
  const items = [...logs].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 15);
  if (!items.length) {
    feed.innerHTML = '<li class="empty">Belum ada yang absen hari ini.</li>';
    return;
  }
  feed.innerHTML = items.map((l) => {
    const pill = l.type === 'masuk'
      ? (l.status === 'terlambat' ? '<span class="pill late">terlambat</span>' : '<span class="pill ok">tepat waktu</span>')
      : (l.status === 'pulang-awal' ? '<span class="pill late">pulang awal</span>' : '<span class="pill info">pulang</span>');
    return `<li><span class="av">${esc(initials(l.name))}</span><span class="nm">${esc(l.name)}<span class="meta">${l.type === 'masuk' ? 'Masuk' : 'Pulang'} ${pill}</span></span><span class="tm">${hhmm(new Date(l.time))}</span></li>`;
  }).join('');
}

// ---------------- Karyawan ----------------

function renderPeople() {
  const list = $('people-list');
  $('people-count').textContent = `${state.people.length} orang`;
  const divisi = [...new Set(state.people.map((p) => p.division).filter(Boolean))];
  $('divisi-list').innerHTML = divisi.map((d) => `<option value="${esc(d)}"></option>`).join('');
  const sel = $('rk-orang');
  const current = sel.value;
  sel.innerHTML = '<option value="">Semua karyawan</option>' + [...state.people].sort((a, b) => a.name.localeCompare(b.name, 'id')).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  sel.value = current;
  if (!state.people.length) {
    list.innerHTML = '<div class="empty-state"><b>Belum ada karyawan</b>Isi form di samping, lalu rekam 5 sampel wajah. Prosesnya sekitar 10 detik per orang.</div>';
    return;
  }
  list.innerHTML = [...state.people].sort((a, b) => a.name.localeCompare(b.name, 'id')).map((p) => {
    const d = new Date(p.createdAt);
    const meta = [p.code, p.division, `${p.descriptors.length} sampel`, `didaftarkan ${d.getDate()} ${NAMA_BULAN[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`].filter(Boolean).join(' · ');
    return `<div class="person"><span class="av">${esc(initials(p.name))}</span><div class="info"><b>${esc(p.name)}</b><span>${esc(meta)}</span></div><div class="acts"><button class="icon-btn" type="button" data-del="${esc(p.id)}" aria-label="Hapus ${esc(p.name)}"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button></div></div>`;
  }).join('');
}

function bindEnroll() {
  $('enroll-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nama = $('en-nama').value.trim();
    if (!nama) return;
    if (!$('en-setuju').checked) { toast('Centang persetujuan karyawan terlebih dulu.'); return; }
    unlockAudio();
    if (!(await startCamera())) { toast('Kamera belum bisa dipakai. Cek izin kamera.'); return; }
    if (!face.isReady()) { toast('Model wajah masih dimuat. Tunggu sebentar.'); return; }
    state.enroll = { name: nama, code: $('en-kode').value.trim(), division: $('en-divisi').value.trim(), samples: [], lastAt: 0 };
    state.mode = 'enroll';
    $('enroll-form').hidden = true;
    $('enroll-stage').hidden = false;
    el.videoEnroll.play().catch(() => {});
    updateEnrollUI();
    schedule(100);
  });
  $('btn-enroll-cancel').addEventListener('click', cancelEnroll);
  $('people-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const p = state.people.find((x) => x.id === btn.dataset.del);
    if (!p) return;
    const ok = await ask({ title: `Hapus ${p.name}?`, body: 'Data wajahnya dihapus dari perangkat ini. Riwayat absensinya tetap ada di rekap.', okText: 'Hapus', danger: true });
    if (!ok) return;
    await db.remove('people', p.id);
    state.people = state.people.filter((x) => x.id !== p.id);
    renderPeople();
    renderToday();
    toast(`${p.name} dihapus.`);
  });
}

function cancelEnroll() {
  state.mode = 'idle';
  state.enroll = null;
  $('enroll-stage').hidden = true;
  $('enroll-form').hidden = false;
  const ctx = el.overlayEnroll.getContext('2d');
  ctx.clearRect(0, 0, el.overlayEnroll.width, el.overlayEnroll.height);
}

function updateEnrollUI(hint) {
  const e = state.enroll;
  const n = e.samples.length;
  $('enroll-step').textContent = `Sampel ${Math.min(n + 1, ENROLL_SAMPLES)} dari ${ENROLL_SAMPLES}`;
  $('enroll-instruction').textContent = hint || ENROLL_STEPS[Math.min(n, ENROLL_STEPS.length - 1)];
  [...$('enroll-dots').children].forEach((d, i) => {
    d.classList.toggle('done', i < n);
    d.classList.toggle('now', i === n);
  });
}

async function enrollTick(video) {
  const e = state.enroll;
  if (!e) return;
  const f = await face.readFace(video);
  drawBox(el.overlayEnroll, video, f, f && f.sizeRatio >= 0.2 ? COLOR.ok : COLOR.scan);
  if (!f) { updateEnrollUI('Wajah belum terlihat'); return; }
  if (f.sizeRatio < 0.2) { updateEnrollUI('Mendekat sedikit ke kamera'); return; }
  if (f.score < 0.6) { updateEnrollUI('Cari tempat yang lebih terang'); return; }
  if (Date.now() - e.lastAt < 700) return;
  e.samples.push(f.descriptor);
  e.lastAt = Date.now();
  updateEnrollUI();
  if (e.samples.length >= ENROLL_SAMPLES) await finishEnroll();
}

async function finishEnroll() {
  const e = state.enroll;
  state.mode = 'idle';
  const mirip = e.samples.map((s) => bestMatch(s, state.people, Number(state.settings.ambang))).find((m) => m.person);
  if (mirip) {
    const lanjut = await ask({ title: 'Wajah ini sudah terdaftar?', body: `Wajah ini mirip dengan ${mirip.person.name}. Simpan tetap sebagai orang baru?`, okText: 'Tetap simpan' });
    if (!lanjut) { cancelEnroll(); return; }
  }
  const person = { id: uid(), name: e.name, code: e.code, division: e.division, descriptors: e.samples, createdAt: new Date().toISOString() };
  await db.put('people', person);
  state.people.push(person);
  feedback(`${e.name} terdaftar`);
  toast(`${e.name} terdaftar dengan ${e.samples.length} sampel wajah.`);
  $('enroll-form').reset();
  cancelEnroll();
  renderPeople();
  renderToday();
}

// ---------------- Rekap ----------------

function bindRekap() {
  const now = new Date();
  $('rk-dari').value = dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  $('rk-sampai').value = dateKey(now);
  ['rk-dari', 'rk-sampai', 'rk-orang'].forEach((id) => $(id).addEventListener('change', renderRekap));
  $('btn-csv-log').addEventListener('click', () => exportCSV('log'));
  $('btn-csv-ringkas').addEventListener('click', () => exportCSV('ringkas'));
}

async function rekapData() {
  const from = $('rk-dari').value;
  const to = $('rk-sampai').value;
  const orang = $('rk-orang').value;
  let logs = await db.getAll('logs');
  if (orang) logs = logs.filter((l) => l.personId === orang);
  const rows = buildRows(logs, state.people, from, to);
  return { rows, summary: summarize(rows), from, to };
}

async function renderRekap() {
  const { rows, summary } = await rekapData();
  const hadir = rows.filter((r) => r.masuk);
  const telat = rows.filter((r) => r.status === 'terlambat').length;
  const totalMenit = rows.reduce((a, r) => a + (r.durasi || 0), 0);
  const avg = hadir.length ? Math.round(hadir.reduce((a, r) => a + minutesOfDate(new Date(r.masuk)), 0) / hadir.length) : null;
  $('tl-hadir').textContent = hadir.length;
  $('tl-hadir-sub').textContent = `${new Set(hadir.map((r) => r.personId)).size} orang, ${new Set(hadir.map((r) => r.date)).size} hari`;
  $('tl-telat').textContent = telat;
  $('tl-telat-sub').textContent = `${hadir.length ? Math.round((telat / hadir.length) * 100) : 0}% dari kehadiran`;
  $('tl-rata').textContent = avg == null ? '-' : `${String(Math.floor(avg / 60)).padStart(2, '0')}:${String(avg % 60).padStart(2, '0')}`;
  $('tl-jam').textContent = `${Math.round(totalMenit / 60)} jam`;

  $('tb-ringkas').innerHTML = summary.length ? summary.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.division || '-')}</td><td class="num">${s.hadir}</td><td class="num">${s.terlambat}</td><td class="num">${s.pulangAwal}</td><td class="num">${s.rataMasuk || '-'}</td><td class="num">${formatDurasi(s.totalMenit)}</td></tr>`).join('')
    : '<tr><td class="empty" colspan="7">Belum ada data absensi pada rentang tanggal ini.</td></tr>';

  $('log-count').textContent = `${rows.length} baris`;
  $('tb-log').innerHTML = rows.length ? rows.map((r) => {
    const st = r.status === 'terlambat' ? '<span class="pill late">terlambat</span>' : r.masuk ? '<span class="pill ok">tepat waktu</span>' : '<span class="pill bad">tanpa absen masuk</span>';
    const pa = r.pulangAwal ? ' <span class="pill late">pulang awal</span>' : (r.masuk && !r.pulang ? ' <span class="pill info">belum pulang</span>' : '');
    const d = new Date(r.date + 'T00:00:00');
    return `<tr><td>${d.getDate()} ${NAMA_BULAN[d.getMonth()].slice(0, 3)} ${d.getFullYear()}</td><td>${esc(r.name)}</td><td>${r.masuk ? hhmm(new Date(r.masuk)) : '-'}</td><td>${r.pulang ? hhmm(new Date(r.pulang)) : '-'}</td><td class="num">${formatDurasi(r.durasi)}</td><td>${st}${pa}</td></tr>`;
  }).join('') : '<tr><td class="empty" colspan="6">Belum ada data absensi pada rentang tanggal ini.</td></tr>';
}

async function exportCSV(jenis) {
  const { rows, summary, from, to } = await rekapData();
  const tempat = (state.settings.namaTempat || 'absensi').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (jenis === 'log') {
    const csv = toCSV(
      ['Tanggal', 'Nama', 'ID karyawan', 'Divisi', 'Masuk', 'Pulang', 'Durasi (menit)', 'Status masuk', 'Pulang awal'],
      rows.map((r) => [r.date, r.name, r.code, r.division, r.masuk ? hhmm(new Date(r.masuk)) : '', r.pulang ? hhmm(new Date(r.pulang)) : '', r.durasi ? Math.round(r.durasi) : '', r.status || 'tanpa absen masuk', r.pulangAwal ? 'ya' : 'tidak'])
    );
    download(`log-${tempat}-${from}-sd-${to}.csv`, csv, 'text/csv;charset=utf-8');
  } else {
    const csv = toCSV(
      ['Nama', 'ID karyawan', 'Divisi', 'Hari hadir', 'Terlambat', 'Pulang awal', 'Rata-rata jam masuk', 'Total jam kerja'],
      summary.map((s) => [s.name, s.code, s.division, s.hadir, s.terlambat, s.pulangAwal, s.rataMasuk || '', (s.totalMenit / 60).toFixed(1).replace('.', ',')])
    );
    download(`ringkasan-${tempat}-${from}-sd-${to}.csv`, csv, 'text/csv;charset=utf-8');
  }
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(`File ${name} diunduh.`);
}

// ---------------- Pengaturan ----------------

function applySettingsUI() {
  const s = state.settings;
  $('place-name').textContent = s.namaTempat || 'Kantor Saya';
  document.title = `Hadir · ${s.namaTempat || 'Absensi Wajah'}`;
  $('clock-rule').textContent = `Masuk ${s.jamMasuk} · toleransi ${s.toleransi} menit · pulang ${s.jamPulang}`;
  $('ambang-out').textContent = Number(s.ambang).toFixed(2).replace('.', ',');
  renderPinNote();
}

function fillSettingsForm() {
  const s = state.settings;
  $('set-tempat').value = s.namaTempat;
  $('set-masuk').value = s.jamMasuk;
  $('set-toleransi').value = s.toleransi;
  $('set-pulang').value = s.jamPulang;
  $('set-jeda').value = s.jedaMinimal;
  $('set-ambang').value = s.ambang;
  $('set-kedip').checked = !!s.wajibKedip;
  $('set-suara').value = s.suara;
  $('set-sheets').value = s.sheetsUrl;
}

function renderPinNote() {
  const note = $('pin-note');
  if (state.settings.pinHash) {
    note.innerHTML = 'PIN aktif: menu selain Absen terkunci. Isi PIN baru untuk mengganti, atau <button type="button" class="linklike" id="btn-pin-off">matikan PIN</button>.';
    $('btn-pin-off').addEventListener('click', async () => {
      state.settings.pinHash = '';
      await db.saveSettings({ pinHash: '' });
      renderPinNote();
      toast('PIN admin dimatikan.');
    });
  } else {
    note.textContent = 'Bila diisi, menu selain Absen meminta PIN, jadi layar absen aman ditinggal.';
  }
}

function bindSettings() {
  const form = $('settings-form');
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('change', async (e) => {
    const t = e.target;
    if (!t.name) return;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (['toleransi', 'jedaMinimal'].includes(t.name)) v = Math.max(0, parseInt(v, 10) || 0);
    if (t.name === 'ambang') v = Number(v);
    if (t.name === 'sheetsUrl') v = String(v).trim();
    state.settings[t.name] = v;
    await db.saveSettings({ [t.name]: v });
    applySettingsUI();
    $('save-state').textContent = `Tersimpan pukul ${hhmm(new Date())}.`;
    if (t.name === 'sheetsUrl') retryUnsynced();
  });
  $('set-ambang').addEventListener('input', (e) => { $('ambang-out').textContent = Number(e.target.value).toFixed(2).replace('.', ','); });
  $('set-pin').addEventListener('change', async (e) => {
    const v = e.target.value.trim();
    if (!v) return;
    if (!/^\d{4,8}$/.test(v)) { toast('PIN harus 4 sampai 8 angka.'); return; }
    state.settings.pinHash = await sha256(v);
    await db.saveSettings({ pinHash: state.settings.pinHash });
    e.target.value = '';
    state.unlocked = true;
    renderPinNote();
    toast('PIN admin aktif.');
  });

  $('btn-sheets-test').addEventListener('click', async () => {
    const url = state.settings.sheetsUrl;
    if (!/^https:\/\/script\.google\.com\//.test(url)) { toast('Isi URL Web App dari script.google.com terlebih dulu.'); return; }
    try {
      await sendTest(url, state.settings.namaTempat);
      toast('Baris tes dikirim. Buka Google Sheet kamu untuk mengecek.');
    } catch (err) {
      toast('Gagal mengirim. Cek koneksi internet dan URL.');
    }
  });

  $('btn-backup').addEventListener('click', async () => {
    const { pinHash, ...settings } = state.settings;
    const data = { app: 'hadir', version: 1, exportedAt: new Date().toISOString(), settings, people: await db.getAll('people'), logs: await db.getAll('logs') };
    download(`cadangan-hadir-${dateKey(new Date())}.json`, JSON.stringify(data), 'application/json');
  });

  $('file-restore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (err) { toast('File bukan cadangan yang valid.'); return; }
    if (data.app !== 'hadir' || !Array.isArray(data.people) || !Array.isArray(data.logs)) { toast('File ini bukan cadangan dari Hadir.'); return; }
    const ok = await ask({ title: 'Pulihkan cadangan?', body: `Data di perangkat ini akan diganti dengan ${data.people.length} karyawan dan ${data.logs.length} log dari cadangan.`, okText: 'Pulihkan', danger: true });
    if (!ok) return;
    await db.clear('people');
    await db.clear('logs');
    await db.putMany('people', data.people);
    await db.putMany('logs', data.logs);
    if (data.settings) await db.saveSettings({ ...data.settings, pinHash: state.settings.pinHash });
    state.settings = await db.getSettings(DEFAULT_SETTINGS);
    state.people = data.people;
    await refreshToday();
    fillSettingsForm(); applySettingsUI(); renderPeople(); renderToday();
    toast('Cadangan berhasil dipulihkan.');
  });

  $('btn-reset').addEventListener('click', async () => {
    const v = await ask({ title: 'Hapus semua data?', body: 'Semua wajah karyawan dan riwayat absensi di perangkat ini akan dihapus. Ketik HAPUS untuk melanjutkan.', input: 'text', okText: 'Hapus semua', danger: true, validate: (x) => (x.trim().toUpperCase() === 'HAPUS' ? '' : 'Ketik HAPUS untuk melanjutkan.') });
    if (v == null) return;
    await db.clear('people');
    await db.clear('logs');
    state.people = [];
    state.todayLogs = [];
    renderPeople(); renderToday();
    toast('Semua data dihapus.');
  });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hadir:' + text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------- Sinkron Google Sheets ----------------

async function syncOne(log) {
  const url = state.settings.sheetsUrl;
  if (!url) return;
  try {
    await sendLog(url, log, state.settings.namaTempat);
    log.synced = true;
    await db.put('logs', log);
  } catch (err) {
    console.warn('Gagal sinkron, akan dicoba lagi:', err);
  }
  updateSyncStatus();
}

async function retryUnsynced() {
  const url = state.settings.sheetsUrl;
  if (!url || !navigator.onLine) { updateSyncStatus(); return; }
  const pending = (await db.getAll('logs')).filter((l) => !l.synced).sort((a, b) => a.time.localeCompare(b.time));
  for (const log of pending) {
    try {
      await sendLog(url, log, state.settings.namaTempat);
      log.synced = true;
      await db.put('logs', log);
    } catch (err) {
      break;
    }
  }
  updateSyncStatus();
}

async function updateSyncStatus() {
  const out = $('sync-status');
  if (!state.settings.sheetsUrl) { out.textContent = 'Belum terhubung.'; return; }
  const pending = (await db.getAll('logs')).filter((l) => !l.synced).length;
  out.textContent = pending ? `${pending} log menunggu dikirim.` : 'Semua log sudah terkirim.';
}

// ---------------- Modal + toast ----------------

let modalResolve = null;
let modalValidate = null;

function bindModal() {
  $('modal-cancel').addEventListener('click', () => closeModal(null));
  $('modal-ok').addEventListener('click', submitModal);
  $('modal-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitModal(); });
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(null); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(null); });
}

function ask({ title, body, input = null, okText = 'Lanjut', danger = false, validate = null }) {
  $('modal-title').textContent = title;
  $('modal-body').textContent = body || '';
  const inp = $('modal-input');
  inp.hidden = !input;
  inp.value = '';
  inp.type = input === 'pin' ? 'password' : 'text';
  inp.inputMode = input === 'pin' ? 'numeric' : 'text';
  $('modal-error').hidden = true;
  const ok = $('modal-ok');
  ok.textContent = okText;
  ok.classList.toggle('danger', danger);
  ok.classList.toggle('primary', !danger);
  $('modal').hidden = false;
  modalValidate = validate;
  setTimeout(() => (input ? inp : ok).focus(), 30);
  return new Promise((resolve) => { modalResolve = { resolve, input }; });
}

async function submitModal() {
  if (!modalResolve) return;
  const v = modalResolve.input ? $('modal-input').value : true;
  if (modalValidate) {
    const err = await modalValidate(v);
    if (err) {
      $('modal-error').textContent = err;
      $('modal-error').hidden = false;
      $('modal-input').select();
      return;
    }
  }
  closeModal(v);
}

function closeModal(value) {
  $('modal').hidden = true;
  const r = modalResolve;
  modalResolve = null;
  modalValidate = null;
  if (r) r.resolve(value);
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ---------------- PWA ----------------

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker gagal:', err));
  }
}
