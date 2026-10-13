import * as db from './db.js';
import * as face from './face.js';
import {
  DEFAULT_SETTINGS, MATCH, LIMITS, HARI_SINGKAT, NAMA_BULAN,
  dateKey, parseDateKey, hhmm, jam, titik, formatTanggal, formatDurasi, sapaan, minutesOfDate,
  matchFace, bestMatch, confidence, shouldLearn, addLive, euclidean,
  decideAction, buildRows, summarize, buildSheet, toCSV,
  photoVerdict, maxPairDistance, initials, hue, uid
} from './logic.js';
import { sendLog, sendTest } from './sheets.js';
import { createAvatar, notionists } from './dicebear.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const tanggalPendek = (key) => { const d = parseDateKey(key); return `${d.getDate()} ${NAMA_BULAN[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };

const ICON = {
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.6"/><path d="M5 19.5a7 7 0 0 1 14 0"/></svg>',
  unknown: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M9.8 9.6a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4M12 16.6v.1"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M7 7l.8 11.2A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.8L17 7M9.5 7V4.5h5V7"/></svg>',
  addFace: '<svg viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="10.5" r="2.6"/><path d="M8.5 16.4a4.4 4.4 0 0 1 4.6-1.6M18 15v6M15 18h6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M4 7h3.5c2.5 0 3.7 1.3 5 3.5l1 1.8c1.3 2.2 2.5 3.7 5 3.7H20M4 17h3.5c1.5 0 2.5-.6 3.4-1.6M13.1 8.6C14 7.6 15 7 16.5 7H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5"/></svg>'
};

const ENROLL_STEPS = ['Tatap lurus ke kamera', 'Tengok sedikit ke kiri', 'Tengok sedikit ke kanan', 'Angkat dagu sedikit', 'Senyum tipis'];
const ADD_STEPS = ['Tatap lurus ke kamera', 'Tengok sedikit ke kiri', 'Tengok sedikit ke kanan'];
const MAX_PHOTOS = 5;
const TITLES = { absen: 'Absen', karyawan: 'Karyawan', rekap: 'Rekap', pengaturan: 'Pengaturan' };

const state = {
  settings: { ...DEFAULT_SETTINGS },
  people: [],
  todayLogs: [],
  today: dateKey(new Date()),
  view: 'absen',
  unlocked: false,
  stream: null,
  timer: null,
  mode: 'idle', // idle | enroll
  pausedUntil: 0,
  candidate: null,
  candidateHits: 0,
  missHits: 0,
  enroll: null,
  enrollMode: 'kamera',
  photos: [],
  resultTimer: null,
  audio: null,
  freshId: null,
  rosterFilter: 'semua',
  peopleDiv: '',
  calMonth: null,
  rekapDay: null,
  newSeed: null,
  editId: null,
  editSeed: null
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
  resultTime: $('result-time'),
  resultChip: $('result-chip'),
  resultAvatar: $('result-avatar'),
  resultProgress: $('result-progress')
};

// ---------------- Mulai ----------------

init();

async function init() {
  state.settings = await db.getSettings(DEFAULT_SETTINGS);
  state.people = await db.getAll('people');
  await refreshToday();
  buildLiburChips();
  applySettingsUI();
  fillSettingsForm();
  renderPeople();
  renderToday();
  resetResult();
  updateFoot();
  startClock();
  bindNav();
  bindCamera();
  bindEnroll();
  bindRekap();
  bindSettings();
  bindModal();
  $('roster-filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    state.rosterFilter = b.dataset.f;
    renderToday();
  });
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
    $('storage-note').textContent = 'Browser ini tidak mengizinkan penyimpanan permanen (mode privat?). Data hilang saat tab ditutup.';
  }
}

async function refreshToday() {
  state.today = dateKey(new Date());
  state.todayLogs = await db.logsByDate(state.today);
}

// ---------------- Jam ----------------

function startClock() {
  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const now = new Date();
    $('clock-hm').textContent = jam(now);
    $('clock-s').textContent = pad(now.getSeconds());
    $('clock-date').textContent = formatTanggal(now);
    $('top-date').textContent = `${HARI_SINGKAT[now.getDay()]}, ${now.getDate()} ${NAMA_BULAN[now.getMonth()].slice(0, 3)} ${now.getFullYear()}`;
    if (dateKey(now) !== state.today) refreshToday().then(() => { renderToday(); renderPeople(); });
  };
  tick();
  setInterval(tick, 1000);
}

// ---------------- Navigasi + PIN ----------------

function bindNav() {
  document.querySelectorAll('.dest').forEach((btn) => btn.addEventListener('click', () => go(btn.dataset.view)));
}

async function go(view) {
  if (view === state.view) return;
  if (view !== 'absen' && state.settings.pinHash && !state.unlocked) {
    const pin = await ask({
      title: 'Masukkan PIN admin', body: 'Menu ini hanya untuk admin.', input: 'pin', okText: 'Buka',
      validate: async (v) => ((await sha256(v)) === state.settings.pinHash ? '' : 'PIN salah. Coba lagi.')
    });
    if (pin == null) return;
    state.unlocked = true;
  }
  if (view === 'absen') state.unlocked = false;
  if (state.mode === 'enroll' && view !== 'karyawan') cancelEnroll();
  state.view = view;
  document.querySelectorAll('.view').forEach((s) => { s.hidden = s.dataset.view !== view; });
  document.querySelectorAll('.dest').forEach((b) => {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('page-title').textContent = TITLES[view];
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
    await face.loadModels('.');
    el.chip.classList.add('ready');
    el.chipText.textContent = 'Siap';
    schedule(100);
    updatePhotoUI();
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
    else await kioskTick(video);
  } catch (err) {
    console.error(err);
  }
  schedule(120);
}

const COLOR = { scan: 'rgba(255,255,255,.9)', ok: '#6DD58C', late: '#F2B8B5', warn: '#FFBA2E', info: '#A8C7FA', bad: '#F2B8B5' };

function drawBox(canvas, video, f, color) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!f) return;
  const { x, y, width, height } = f.box;
  const pad = width * 0.14;
  const bx = x - pad, by = y - pad * 1.5, bw = width + pad * 2, bh = height + pad * 2.4;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, w / 240);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, Math.min(bw, bh) * 0.18);
  else ctx.rect(bx, by, bw, bh);
  ctx.stroke();
}

async function kioskTick(video) {
  const paused = Date.now() < state.pausedUntil;
  const f = await face.readFace(video);
  if (paused) {
    drawBox(el.overlayAbsen, video, f, COLOR[el.result.dataset.state] || COLOR.scan);
    return;
  }
  drawBox(el.overlayAbsen, video, f, COLOR.scan);
  if (!f) {
    state.candidate = null; state.candidateHits = 0; state.missHits = 0;
    if (!state.resultTimer) resetResult();
    return;
  }
  if (!state.people.length) {
    setResult({ title: 'Belum ada karyawan terdaftar', sub: 'Daftarkan wajah karyawan di menu Karyawan.' });
    return;
  }
  if (f.sizeRatio < 0.16) {
    setResult({ title: 'Mendekat sedikit', sub: 'Wajah terlalu kecil. Jarak ideal sekitar 50 cm.' });
    return;
  }
  const m = matchFace(f.descriptor, state.people, { ambang: Number(state.settings.ambang) });
  if (!m.person) {
    state.candidate = null; state.candidateHits = 0;
    state.missHits += 1;
    if (state.missHits >= 5) {
      state.missHits = 0;
      if (m.reason === 'ragu') setResult({ kind: 'bad', title: 'Belum yakin siapa', chip: 'Coba lagi', sub: `Mirip ${firstName(m.candidates[0].name)} dan ${firstName(m.candidates[1].name)}. Tatap lurus ke kamera.`, ms: 2600, icon: ICON.unknown });
      else setResult({ kind: 'bad', title: 'Wajah tidak dikenali', chip: 'Belum terdaftar', sub: 'Pastikan wajah cukup terang.', ms: 2600, icon: ICON.unknown });
      state.pausedUntil = Date.now() + 2000;
    }
    return;
  }
  state.missHits = 0;
  if (state.candidate && state.candidate.id === m.person.id) state.candidateHits += 1;
  else { state.candidate = m.person; state.candidateHits = 1; }
  if (state.candidateHits < MATCH.frames) return;

  const person = m.person;
  state.candidate = null; state.candidateHits = 0;
  const now = new Date();
  const action = decideAction(state.todayLogs.filter((l) => l.personId === person.id), now, state.settings);
  const nama = firstName(person.name);

  if (action.type === 'jeda') {
    setResult({ kind: 'info', title: `${nama}, absen masuk sudah tercatat`, chip: 'Sudah masuk', sub: `Absen pulang bisa ${action.tungguMenit} menit lagi`, ms: 3800, person, time: jam(new Date(action.masuk.time)) });
    state.pausedUntil = Date.now() + 3800;
    return;
  }
  if (action.type === 'selesai') {
    setResult({ kind: 'info', title: `${nama}, absen hari ini lengkap`, chip: 'Selesai', sub: `Masuk ${jam(new Date(action.masuk.time))} · pulang ${jam(new Date(action.pulang.time))}`, ms: 3800, person });
    state.pausedUntil = Date.now() + 3800;
    return;
  }
  await record(person, action, m, f.descriptor);
}

async function record(person, action, m, liveDescriptor) {
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
    distance: Number(m.distance.toFixed(3)),
    synced: false
  };
  await db.put('logs', log);

  // Wajah yang jelas cocok tapi tampak berbeda (kacamata, rambut, cahaya) ikut dipelajari.
  if (liveDescriptor && shouldLearn({ distance: m.distance, plain: m.plain, margin: m.margin, ambang: Number(state.settings.ambang) })) {
    person.live = addLive(person, liveDescriptor);
    await db.put('people', person);
  }

  if (log.date === state.today) state.todayLogs.push(log);
  else await refreshToday();
  state.freshId = person.id;
  renderToday();
  renderPeople();

  const nama = firstName(person.name);
  const yakin = `cocok ${confidence(m.distance, Number(state.settings.ambang))}%`;
  const time = jam(now);
  if (action.type === 'masuk') {
    if (action.status === 'terlambat') setResult({ kind: 'late', title: `${sapaan(now)}, ${nama}`, chip: `Terlambat ${action.telatMenit} menit`, sub: yakin, ms: 4200, person, time });
    else setResult({ kind: 'ok', title: `${sapaan(now)}, ${nama}`, chip: 'Tepat waktu', sub: yakin, ms: 4200, person, time });
  } else {
    const masuk = state.todayLogs.find((l) => l.personId === person.id && l.type === 'masuk');
    const durasi = masuk ? formatDurasi((now - new Date(masuk.time)) / 60000) : '—';
    if (action.status === 'pulang-awal') setResult({ kind: 'warn', title: `Pulang lebih awal, ${nama}`, chip: 'Pulang awal', sub: `Kerja ${durasi}`, ms: 4200, person, time });
    else setResult({ kind: 'ok', title: `Hati-hati di jalan, ${nama}`, chip: 'Pulang', sub: `Kerja ${durasi}`, ms: 4200, person, time });
  }
  feedback(action.type === 'masuk' ? `${sapaan(now)}, ${nama}` : `Hati-hati di jalan, ${nama}`);
  state.pausedUntil = Date.now() + 4200;
  syncOne(log);
}

// ---------------- Panel hasil ----------------

function setResult({ kind = 'idle', title, chip = '', sub = '', ms = 0, person = null, icon = null, time = '' }) {
  clearTimeout(state.resultTimer);
  state.resultTimer = null;
  el.result.dataset.state = kind;
  el.resultTitle.textContent = title;
  el.resultChip.textContent = chip;
  el.resultChip.hidden = !chip;
  el.resultSub.textContent = sub;
  el.resultTime.textContent = time;
  if (person) {
    el.resultAvatar.className = 'result-av';
    el.resultAvatar.innerHTML = `<img src="${avatarFor(person)}" alt="">`;
  } else {
    el.resultAvatar.className = 'result-av';
    el.resultAvatar.innerHTML = icon || ICON.user;
  }
  const bar = el.resultProgress;
  bar.style.transition = 'none';
  bar.style.width = ms ? '100%' : '0';
  if (ms) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.transition = `width ${ms}ms linear`;
      bar.style.width = '0';
    }));
    state.resultTimer = setTimeout(() => { state.resultTimer = null; resetResult(); }, ms);
  }
}

function resetResult() {
  setResult({ title: 'Hadapkan wajah ke kamera', sub: 'Jarak sekitar 50 cm, wajah terlihat jelas.' });
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
  const byPerson = new Map();
  for (const l of state.todayLogs) {
    if (!byPerson.has(l.personId)) byPerson.set(l.personId, { name: l.name, division: l.division, masuk: null, pulang: null });
    const r = byPerson.get(l.personId);
    if (l.type === 'masuk') r.masuk = l;
    if (l.type === 'pulang') r.pulang = l;
  }
  const hadir = [...byPerson.entries()].filter(([, r]) => r.masuk).sort((a, b) => b[1].masuk.time.localeCompare(a[1].masuk.time));
  const telat = hadir.filter(([, r]) => r.masuk.status === 'terlambat');
  const pulang = hadir.filter(([, r]) => r.pulang);
  const belum = state.people.filter((p) => !byPerson.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'id'));

  $('today-big').textContent = `${hadir.length}/${Math.max(state.people.length, hadir.length)}`;
  const filters = [['semua', 'Semua', null], ['terlambat', 'Terlambat', telat.length], ['belum', 'Belum', belum.length], ['pulang', 'Pulang', pulang.length]];
  $('roster-filter').innerHTML = filters.map(([k, label, n]) => `<button type="button" class="fchip" data-f="${k}" aria-pressed="${state.rosterFilter === k}">${label}${n == null ? '' : ` <small>${n}</small>`}</button>`).join('');

  let showHadir = hadir;
  let showBelum = belum;
  if (state.rosterFilter === 'terlambat') { showHadir = telat; showBelum = []; }
  if (state.rosterFilter === 'pulang') { showHadir = pulang; showBelum = []; }
  if (state.rosterFilter === 'belum') { showHadir = []; }

  const feed = $('feed');
  if (!state.people.length && !hadir.length) {
    feed.innerHTML = '<li class="empty">Daftarkan karyawan di menu Karyawan.</li>';
    return;
  }
  if (!showHadir.length && !showBelum.length) {
    const kosong = { terlambat: 'Belum ada yang terlambat hari ini.', pulang: 'Belum ada yang pulang.', belum: 'Semua karyawan sudah hadir.', semua: 'Belum ada yang absen hari ini.' };
    feed.innerHTML = `<li class="empty">${kosong[state.rosterFilter]}</li>`;
    return;
  }
  const row = (id, r) => {
    const late = r.masuk.status === 'terlambat';
    const pTime = r.pulang ? `<span class="t ${r.pulang.status === 'pulang-awal' ? 'warn' : ''}">${jam(new Date(r.pulang.time))}</span>` : '<span class="t none">—</span>';
    return `<li class="${id === state.freshId ? 'fresh' : ''}">${avatar(state.people.find((p) => p.id === id) || r.name)}<span class="nm"><b>${esc(r.name)}</b><span>${esc(late ? 'Terlambat' : (r.division || 'Tepat waktu'))}</span></span><span class="t ${late ? 'late' : ''}">${jam(new Date(r.masuk.time))}</span>${pTime}</li>`;
  };
  const absent = (p) => `<li class="absent">${avatar(p)}<span class="nm"><b>${esc(p.name)}</b><span>${esc(p.division || 'Belum hadir')}</span></span><span class="t none">—</span><span class="t none">—</span></li>`;
  feed.innerHTML = showHadir.map(([id, r]) => row(id, r)).join('') + showBelum.map(absent).join('');
  state.freshId = null;
}

// ---------------- Karyawan ----------------

// Ilustrasi garis untuk tiap karyawan (DiceBear Notionists, desain CC0).
// Bentuknya ditentukan "seed" + jenis kelamin, jadi cukup itu yang disimpan.
const AV_BG = ['f9d7c6', 'd9e8d4', 'f5e2b8', 'e3d8f1', 'f6cfd6', 'd2e3ee'];
const v = (list) => list.map((n) => `variant${String(n).padStart(2, '0')}`);
const HAIR = {
  L: v([1, 3, 5, 6, 7, 9, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 30, 31, 32, 33, 34, 35, 38, 40, 42, 44, 49, 50, 51, 52, 53, 54, 55, 56, 60]),
  P: v([2, 4, 8, 10, 11, 23, 28, 29, 36, 37, 39, 41, 43, 45, 46, 47, 48, 57, 58, 59]),
  H: v([61, 62, 63])
};
const avCache = new Map();

function avatarUri(seed, gender = '', hijab = false) {
  const s = String(seed || 'hadir');
  const key = `${s}|${gender}|${hijab ? 1 : 0}`;
  if (!avCache.has(key)) {
    const opts = { seed: s, backgroundColor: [AV_BG[hue(s)]], gestureProbability: 0 };
    if (gender === 'L') { opts.hair = HAIR.L; opts.beardProbability = 25; }
    else if (gender === 'P') { opts.hair = hijab ? HAIR.H : HAIR.P; opts.beardProbability = 0; }
    else { opts.hair = [...HAIR.L, ...HAIR.P]; opts.beardProbability = 0; }
    avCache.set(key, createAvatar(notionists, opts).toDataUri());
  }
  return avCache.get(key);
}

function avatarFor(p) {
  return avatarUri(p.avatarSeed || p.name, p.gender || '', !!p.hijab);
}

function avatar(who) {
  let src;
  if (who && typeof who === 'object') src = avatarFor(who);
  else {
    const p = state.people.find((x) => x.id === who || x.name === who);
    src = p ? avatarFor(p) : avatarUri(who);
  }
  return `<span class="av" aria-hidden="true"><img src="${src}" alt="" decoding="async"></span>`;
}

function randomSeed() {
  return Math.random().toString(36).slice(2, 10);
}

// Pilihan jenis kelamin + hijab di form (prefix 'en' = pendaftaran, 'ed' = ubah profil).
function genderOf(prefix) {
  const r = document.querySelector(`input[name="${prefix}-gender"]:checked`);
  return r ? r.value : '';
}
function hijabOf(prefix) {
  return genderOf(prefix) === 'P' && $(`${prefix}-hijab`).checked;
}
function syncGender(prefix) {
  $(`${prefix}-hijab-wrap`).hidden = genderOf(prefix) !== 'P';
}

function renderPeople() {
  const list = $('people-list');
  const q = $('people-search').value.trim().toLowerCase();
  $('people-count').textContent = `${state.people.length} orang`;
  const divisi = [...new Set(state.people.map((p) => p.division).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
  $('divisi-list').innerHTML = divisi.map((d) => `<option value="${esc(d)}"></option>`).join('');
  const sel = $('rk-orang');
  const current = sel.value;
  const sorted = [...state.people].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  sel.innerHTML = '<option value="">Semua karyawan</option>' + sorted.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  sel.value = current;

  if (state.peopleDiv && !divisi.includes(state.peopleDiv)) state.peopleDiv = '';
  const chips = $('people-filter');
  chips.hidden = divisi.length < 2;
  chips.innerHTML = [['', 'Semua'], ...divisi.map((d) => [d, d])].map(([v, l]) => `<button type="button" class="fchip" data-div="${esc(v)}" aria-pressed="${state.peopleDiv === v}">${esc(l)}</button>`).join('');

  if (!state.people.length) {
    list.innerHTML = '<div class="empty-state"><b>Belum ada karyawan</b>Daftarkan lewat kamera (sekitar 10 detik per orang) atau dari 1–5 foto wajah.</div>';
    return;
  }
  const shown = sorted
    .filter((p) => !state.peopleDiv || p.division === state.peopleDiv)
    .filter((p) => !q || [p.name, p.code, p.division].some((v) => String(v || '').toLowerCase().includes(q)));
  if (!shown.length) {
    list.innerHTML = `<div class="empty-state"><b>Tidak ditemukan</b>Tidak ada karyawan yang cocok dengan pencarian.</div>`;
    return;
  }
  const masukHariIni = new Map(state.todayLogs.filter((l) => l.type === 'masuk').map((l) => [l.personId, l]));
  list.innerHTML = shown.map((p) => {
    const m = masukHariIni.get(p.id);
    const late = m && m.status === 'terlambat';
    const top = m ? `<span class="badge-top ${late ? 'late' : ''}">${jam(new Date(m.time))}</span>` : '';
    const bot = m ? `<span class="badge-bot ${late ? 'late' : 'ok'}">${late ? 'Terlambat' : 'Hadir'}</span>` : '<span class="badge-bot">Belum hadir</span>';
    const asli = (p.descriptors || []).length;
    const sampel = [`${asli} ${p.source === 'foto' ? 'foto' : 'sampel'}`, (p.augmented || []).length ? 'kacamata' : '', (p.live || []).length ? `+${p.live.length} belajar` : ''].filter(Boolean).join(' · ');
    const meta = [p.division, p.code].filter(Boolean).join(' · ') || '—';
    const atur = p.gender ? '' : ' · atur profil';
    return `<div class="tile">
      <div class="acts">
        <button class="mini" type="button" data-edit="${esc(p.id)}" title="Ubah profil" aria-label="Ubah profil ${esc(p.name)}">${ICON.edit}</button>
        <button class="mini" type="button" data-add="${esc(p.id)}" title="Tambah wajah" aria-label="Tambah wajah ${esc(p.name)}">${ICON.addFace}</button>
        <button class="mini del" type="button" data-del="${esc(p.id)}" title="Hapus" aria-label="Hapus ${esc(p.name)}">${ICON.trash}</button>
      </div>
      <div class="tile-av">${top}${avatar(p)}${bot}</div>
      <b title="${esc(p.name)}">${esc(p.name)}</b>
      <span class="sub">${esc(meta)}</span>
      <span class="sub">${esc(sampel + atur)}</span>
    </div>`;
  }).join('');
}

function bindEnroll() {
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => setEnrollMode(b.dataset.mode)));
  bindPhotoInput();
  $('people-search').addEventListener('input', renderPeople);
  $('people-filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-div]');
    if (!b) return;
    state.peopleDiv = b.dataset.div;
    renderPeople();
  });
  ['en-nama', 'en-divisi'].forEach((id) => $(id).addEventListener('input', updateFoot));
  $('btn-shuffle').addEventListener('click', () => { state.newSeed = randomSeed(); updateFoot(); });
  document.querySelectorAll('input[name="en-gender"], #en-hijab').forEach((i) => i.addEventListener('change', () => { syncGender('en'); updateFoot(); }));
  bindEdit();
  $('enroll-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nama = $('en-nama').value.trim();
    if (!nama) return;
    if (!genderOf('en')) { toast('Pilih jenis kelamin supaya ilustrasinya sesuai.'); return; }
    if (!$('en-setuju').checked) { toast('Centang persetujuan karyawan terlebih dulu.'); return; }
    unlockAudio();
    if (state.enrollMode === 'foto') { await saveFromPhotos(); return; }
    await startCameraEnroll({ kind: 'baru', name: nama, code: $('en-kode').value.trim(), division: $('en-divisi').value.trim(), gender: genderOf('en'), hijab: hijabOf('en') });
  });
  $('btn-enroll-cancel').addEventListener('click', cancelEnroll);
  $('people-list').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const p = state.people.find((x) => x.id === edit.dataset.edit);
      if (p) openEdit(p);
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const p = state.people.find((x) => x.id === add.dataset.add);
      if (p) await startCameraEnroll({ kind: 'tambah', target: p });
      return;
    }
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const p = state.people.find((x) => x.id === del.dataset.del);
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

async function startCameraEnroll(job) {
  if (!(await startCamera())) { toast('Kamera belum bisa dipakai. Cek izin kamera.'); return; }
  if (!face.isReady()) { toast('Model wajah masih dimuat. Tunggu sebentar.'); return; }
  const steps = job.kind === 'tambah' ? ADD_STEPS : ENROLL_STEPS;
  state.enroll = { ...job, steps, samples: [], lastAt: 0, snapshot: null };
  state.mode = 'enroll';
  $('enroll-form').hidden = true;
  $('enroll-stage').hidden = false;
  $('enroll-title').textContent = job.kind === 'tambah' ? `Tambah wajah · ${job.target.name}` : `Rekam wajah · ${job.name}`;
  $('enroll-note').textContent = job.kind === 'tambah'
    ? 'Bila sering tidak dikenali saat berkacamata, rekam sambil memakai kacamata.'
    : 'Wajah otomatis disiapkan juga dalam versi berkacamata.';
  $('enroll-dots').innerHTML = steps.map(() => '<span></span>').join('');
  el.videoEnroll.play().catch(() => {});
  updateEnrollUI();
  schedule(100);
}

function cancelEnroll() {
  state.mode = 'idle';
  state.enroll = null;
  $('enroll-stage').hidden = true;
  $('enroll-form').hidden = false;
  $('enroll-title').textContent = 'Tambah karyawan';
  updateFoot();
  const ctx = el.overlayEnroll.getContext('2d');
  ctx.clearRect(0, 0, el.overlayEnroll.width, el.overlayEnroll.height);
}

function updateEnrollUI(hint) {
  const e = state.enroll;
  if (!e) return;
  const n = e.samples.length;
  const total = e.steps.length;
  $('enroll-step').textContent = `Sampel ${Math.min(n + 1, total)} dari ${total}`;
  $('enroll-instruction').textContent = hint || e.steps[Math.min(n, total - 1)];
  [...$('enroll-dots').children].forEach((d, i) => {
    d.classList.toggle('done', i < n);
    d.classList.toggle('now', i === n);
  });
}

async function enrollTick(video) {
  const e = state.enroll;
  if (!e || e.busy) return;
  const f = await face.readFace(video);
  drawBox(el.overlayEnroll, video, f, f && f.sizeRatio >= 0.2 ? COLOR.ok : COLOR.scan);
  if (!f) { updateEnrollUI('Wajah belum terlihat'); return; }
  if (f.sizeRatio < 0.2) { updateEnrollUI('Mendekat sedikit ke kamera'); return; }
  if (f.score < 0.6) { updateEnrollUI('Cari tempat yang lebih terang'); return; }
  if (Date.now() - e.lastAt < 700) return;
  if (!e.snapshot) {
    // Frame pertama (menatap lurus) disimpan untuk membuat versi berkacamata.
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    e.snapshot = { canvas: c, box: f.box, points: f.points };
  }
  e.samples.push(f.descriptor);
  e.lastAt = Date.now();
  updateEnrollUI();
  if (e.samples.length >= e.steps.length) await finishEnroll();
}

async function finishEnroll() {
  const e = state.enroll;
  e.busy = true;
  updateEnrollUI('Menyiapkan versi berkacamata…');
  if (e.kind === 'tambah') {
    const p = e.target;
    p.descriptors = [...(p.descriptors || []), ...e.samples].slice(-LIMITS.real);
    if (!(p.augmented || []).length && e.snapshot) p.augmented = await face.augmentGlasses(e.snapshot.canvas, e.snapshot.box, e.snapshot.points);
    await db.put('people', p);
    toast(`${e.samples.length} sampel wajah ditambahkan untuk ${p.name}.`);
    cancelEnroll();
    renderPeople();
    return;
  }
  state.mode = 'idle';
  const mirip = e.samples.map((s) => bestMatch(s, state.people, Number(state.settings.ambang))).find((m) => m.person);
  if (mirip) {
    const lanjut = await ask({ title: 'Wajah ini sudah terdaftar?', body: `Wajah ini mirip dengan ${mirip.person.name}. Simpan tetap sebagai orang baru?`, okText: 'Tetap simpan' });
    if (!lanjut) { cancelEnroll(); return; }
  }
  const augmented = e.snapshot ? await face.augmentGlasses(e.snapshot.canvas, e.snapshot.box, e.snapshot.points) : [];
  const person = {
    id: uid(), name: e.name, code: e.code, division: e.division, source: 'kamera',
    descriptors: e.samples, augmented, live: [], avatarSeed: state.newSeed || e.name, gender: e.gender || '', hijab: !!e.hijab, createdAt: new Date().toISOString()
  };
  state.newSeed = null;
  await db.put('people', person);
  state.people.push(person);
  feedback(`${e.name} terdaftar`);
  toast(`${e.name} terdaftar dan sudah bisa absen.`);
  $('enroll-form').reset();
  syncGender('en');
  cancelEnroll();
  renderPeople();
  renderToday();
}

// ---------------- Ubah profil ----------------

function bindEdit() {
  const refresh = () => {
    syncGender('ed');
    $('edit-av').src = avatarUri(state.editSeed, genderOf('ed'), hijabOf('ed'));
  };
  document.querySelectorAll('input[name="ed-gender"], #ed-hijab').forEach((i) => i.addEventListener('change', refresh));
  $('edit-shuffle').addEventListener('click', () => { state.editSeed = randomSeed(); refresh(); });
  $('edit-cancel').addEventListener('click', closeEdit);
  $('edit-modal').addEventListener('click', (e) => { if (e.target.id === 'edit-modal') closeEdit(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('edit-modal').hidden) closeEdit(); });
  $('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = state.people.find((x) => x.id === state.editId);
    if (!p) { closeEdit(); return; }
    const nama = $('ed-nama').value.trim();
    if (!nama) return;
    p.name = nama;
    p.code = $('ed-kode').value.trim();
    p.division = $('ed-divisi').value.trim();
    p.gender = genderOf('ed');
    p.hijab = hijabOf('ed');
    p.avatarSeed = state.editSeed;
    await db.put('people', p);
    closeEdit();
    renderPeople();
    renderToday();
    toast(`Profil ${p.name} disimpan.`);
  });
}

function openEdit(p) {
  state.editId = p.id;
  state.editSeed = p.avatarSeed || p.name;
  $('ed-nama').value = p.name;
  $('ed-kode').value = p.code || '';
  $('ed-divisi').value = p.division || '';
  document.querySelectorAll('input[name="ed-gender"]').forEach((r) => { r.checked = r.value === p.gender; });
  $('ed-hijab').checked = !!p.hijab;
  syncGender('ed');
  $('edit-av').src = avatarUri(state.editSeed, genderOf('ed'), hijabOf('ed'));
  $('edit-modal').hidden = false;
  setTimeout(() => $('ed-nama').focus(), 30);
}

function closeEdit() {
  $('edit-modal').hidden = true;
  state.editId = null;
}

// ---------------- Daftar dari foto ----------------

function setEnrollMode(mode) {
  if (state.mode === 'enroll') cancelEnroll();
  state.enrollMode = mode;
  document.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('photo-zone').hidden = mode !== 'foto';
  updatePhotoUI();
}

function updateFoot() {
  const nama = $('en-nama').value.trim();
  const div = $('en-divisi').value.trim();
  $('foot-name').textContent = nama || 'Karyawan baru';
  $('foot-av').src = avatarUri(state.newSeed || nama || 'Karyawan baru', genderOf('en'), hijabOf('en'));
  let info;
  if (state.enrollMode === 'foto') {
    const n = usablePhotos().length;
    info = n ? `${n} foto siap` : 'Pilih foto wajah';
  } else {
    info = 'Rekam 5 sampel wajah, sekitar 10 detik';
  }
  $('foot-sub').textContent = [div, info].filter(Boolean).join(' · ');
}

function bindPhotoInput() {
  const input = $('en-foto');
  const drop = $('drop');
  input.addEventListener('change', () => { addPhotos([...input.files]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addPhotos([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))));
  $('photo-thumbs').addEventListener('click', (e) => {
    const x = e.target.closest('[data-rm]');
    if (!x) return;
    state.photos = state.photos.filter((p) => p.key !== x.dataset.rm);
    updatePhotoUI();
  });
}

async function addPhotos(files) {
  if (!files.length) return;
  if (!face.isReady()) { toast('Model wajah masih dimuat. Tunggu sebentar lalu pilih foto lagi.'); return; }
  const room = MAX_PHOTOS - state.photos.length;
  if (room <= 0) { toast(`Maksimal ${MAX_PHOTOS} foto per karyawan.`); return; }
  if (files.length > room) toast(`Hanya ${room} foto pertama yang dipakai (maksimal ${MAX_PHOTOS}).`);
  const batch = files.slice(0, room).map((file) => ({ key: uid(), name: file.name, file, status: 'loading', pesan: 'Membaca wajah…' }));
  state.photos.push(...batch);
  updatePhotoUI();
  for (const item of batch) {
    try {
      Object.assign(item, await analyzePhoto(item.file));
    } catch (err) {
      console.error(err);
      Object.assign(item, { status: 'error', pesan: 'File gambar tidak bisa dibaca' });
    }
    updatePhotoUI();
  }
}

// Baca foto, cari wajah, simpan potongan kecil untuk pratinjau.
async function analyzePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // Kecilkan foto besar, lalu beri bingkai abu-abu supaya wajah di pas foto tetap terbaca.
    const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const border = Math.round(Math.max(w, h) * 0.2);
    const canvas = document.createElement('canvas');
    canvas.width = w + border * 2;
    canvas.height = h + border * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, border, border, w, h);
    const faces = await face.readFacesFromImage(canvas);
    const v = photoVerdict(faces);
    const cropFace = ({ x, y, width, height }) => {
      const side = Math.max(width, height) * 1.7;
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      c.getContext('2d').drawImage(canvas, x + width / 2 - side / 2, y + height / 2 - side / 2, side, side, 0, 0, 160, 160);
      return c.toDataURL('image/jpeg', 0.8);
    };
    if (!v.face) {
      const c = document.createElement('canvas');
      const s = 160 / Math.max(canvas.width, canvas.height);
      c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
      c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
      return { status: 'bad', pesan: v.pesan, thumb: c.toDataURL('image/jpeg', 0.7), cands: [], pick: -1, canvas: null };
    }
    const cands = (v.warn ? faces.filter((f) => f.box.width >= 70).slice(0, 8) : [v.face]).map((f) => ({ ...f, thumb: cropFace(f.box) }));
    const pick = cands.indexOf(cands.find((c) => c.descriptor === v.face.descriptor));
    return {
      status: v.status === 'ok' ? (v.warn ? 'warn' : 'ok') : 'bad',
      pesan: v.pesan,
      cands,
      pick: v.status === 'ok' ? Math.max(0, pick) : -1,
      largest: Math.max(0, pick),
      thumb: cands[Math.max(0, pick)].thumb,
      canvas
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function chosen(p) {
  return p.pick >= 0 && p.cands ? p.cands[p.pick] : null;
}

function usablePhotos() {
  return state.photos.filter((p) => chosen(p));
}

// Foto rombongan: bila ada foto lain berisi satu wajah, pilih wajah yang paling mirip dengannya.
function resolveGroupPhotos() {
  const refs = state.photos.filter((p) => chosen(p) && p.cands.length === 1).map((p) => p.cands[0].descriptor);
  for (const p of state.photos) {
    if (!p.cands || p.cands.length < 2) continue;
    if (!refs.length) {
      p.pick = p.largest;
      p.status = 'warn';
      p.pesan = `${p.cands.length} wajah, dipakai yang terbesar`;
      p.thumb = p.cands[p.pick].thumb;
      continue;
    }
    let best = -1;
    let bestScore = Infinity;
    p.cands.forEach((c, i) => {
      const score = refs.reduce((a, r) => a + euclidean(c.descriptor, r), 0) / refs.length;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (bestScore > 0.6) {
      p.pick = -1;
      p.status = 'bad';
      p.pesan = 'Tidak ada wajah yang cocok dengan foto lain';
    } else {
      p.pick = best;
      p.thumb = p.cands[best].thumb;
      p.status = 'ok';
      p.pesan = `${p.cands.length} wajah, dipilih yang cocok`;
    }
  }
}

function updatePhotoUI() {
  const btn = $('btn-enroll');
  if (state.enrollMode !== 'foto') {
    btn.textContent = 'Mulai rekam';
    btn.disabled = false;
    updateFoot();
    return;
  }
  resolveGroupPhotos();
  $('photo-thumbs').innerHTML = state.photos.map((p) => {
    const cls = p.status === 'loading' ? '' : p.status;
    const pic = p.thumb ? `<img src="${p.thumb}" alt="">` : '<div class="ph"><span class="spinner"></span></div>';
    return `<div class="thumb ${cls}">${pic}<small>${esc(p.pesan)}</small><button type="button" class="x" data-rm="${p.key}" aria-label="Hapus foto ${esc(p.name)}">${ICON.close}</button></div>`;
  }).join('');
  const ok = usablePhotos();
  const loading = state.photos.some((p) => p.status === 'loading');
  const note = $('photo-note');
  note.classList.remove('warn');
  if (!face.isReady()) note.textContent = 'Model wajah sedang dimuat…';
  else if (!state.photos.length) note.textContent = 'Satu foto sudah cukup. Versi berkacamata dibuat otomatis, jadi foto tanpa kacamata tetap bisa dipakai.';
  else if (loading) note.textContent = 'Sedang membaca wajah di foto…';
  else if (!ok.length) note.textContent = 'Belum ada foto yang bisa dipakai. Pilih foto wajah yang lebih jelas.';
  else if (ok.length > 1 && maxPairDistance(ok.map((p) => chosen(p).descriptor)) > 0.6) {
    note.textContent = 'Foto-foto ini sepertinya bukan orang yang sama. Periksa lagi sebelum menyimpan.';
    note.classList.add('warn');
  } else note.textContent = `${ok.length} foto siap dipakai.`;
  btn.textContent = 'Simpan';
  btn.disabled = loading || !ok.length;
  updateFoot();
}

async function saveFromPhotos() {
  const ok = usablePhotos();
  if (!ok.length) { toast('Pilih minimal satu foto dengan wajah yang terdeteksi.'); return; }
  const descriptors = ok.map((p) => chosen(p).descriptor);
  if (descriptors.length > 1 && maxPairDistance(descriptors) > 0.6) {
    const lanjut = await ask({ title: 'Foto dari orang yang sama?', body: 'Wajah di foto-foto ini cukup berbeda satu sama lain. Simpan tetap sebagai satu karyawan?', okText: 'Tetap simpan' });
    if (!lanjut) return;
  }
  const mirip = descriptors.map((s) => bestMatch(s, state.people, Number(state.settings.ambang))).find((m) => m.person);
  if (mirip) {
    const lanjut = await ask({ title: 'Wajah ini sudah terdaftar?', body: `Wajah di foto mirip dengan ${mirip.person.name}. Simpan tetap sebagai orang baru?`, okText: 'Tetap simpan' });
    if (!lanjut) return;
  }
  const btn = $('btn-enroll');
  btn.disabled = true;
  btn.textContent = 'Menyiapkan versi berkacamata…';
  const augmented = [];
  for (const p of ok.slice(0, 2)) {
    const c = chosen(p);
    augmented.push(...(await face.augmentGlasses(p.canvas, c.box, c.points)));
  }
  const nama = $('en-nama').value.trim();
  const person = {
    id: uid(), name: nama, code: $('en-kode').value.trim(), division: $('en-divisi').value.trim(), source: 'foto',
    descriptors, augmented, live: [], avatarSeed: state.newSeed || nama, gender: genderOf('en'), hijab: hijabOf('en'), createdAt: new Date().toISOString()
  };
  state.newSeed = null;
  await db.put('people', person);
  state.people.push(person);
  state.photos = [];
  $('enroll-form').reset();
  syncGender('en');
  updatePhotoUI();
  renderPeople();
  renderToday();
  feedback(`${nama} terdaftar`);
  toast(`${nama} terdaftar dari ${descriptors.length} foto dan sudah bisa absen.`);
}

// ---------------- Rekap ----------------

function bindRekap() {
  const now = new Date();
  $('rk-dari').value = dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  $('rk-sampai').value = dateKey(now);
  ['rk-dari', 'rk-sampai'].forEach((id) => $(id).addEventListener('change', () => { state.calMonth = null; state.rekapDay = null; renderRekap(); }));
  $('rk-orang').addEventListener('change', renderRekap);
  $('btn-csv-log').addEventListener('click', () => exportCSV('log'));
  $('btn-csv-ringkas').addEventListener('click', () => exportCSV('ringkas'));
  $('cal').addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (!b || b.disabled) return;
    state.rekapDay = state.rekapDay === b.dataset.day ? null : b.dataset.day;
    renderRekap();
  });
  const shift = (n) => {
    const m = state.calMonth || new Date();
    state.calMonth = new Date(m.getFullYear(), m.getMonth() + n, 1);
    renderRekap();
  };
  $('cal-prev').addEventListener('click', () => shift(-1));
  $('cal-next').addEventListener('click', () => shift(1));
  $('cal-clear').addEventListener('click', () => { state.rekapDay = null; renderRekap(); });
}

async function rekapData() {
  let from = $('rk-dari').value;
  let to = $('rk-sampai').value;
  if (from && to && from > to) [from, to] = [to, from];
  const orang = $('rk-orang').value;
  let logs = await db.getAll('logs');
  if (orang) logs = logs.filter((l) => l.personId === orang);
  const rows = buildRows(logs, state.people, from, to);
  return { rows, summary: summarize(rows), from, to, orang };
}

async function renderRekap() {
  const { rows, summary, from, to, orang } = await rekapData();
  const hadir = rows.filter((r) => r.masuk);
  const telat = rows.filter((r) => r.status === 'terlambat').length;
  const totalMenit = rows.reduce((a, r) => a + (r.durasi || 0), 0);
  const avg = hadir.length ? Math.round(hadir.reduce((a, r) => a + minutesOfDate(new Date(r.masuk)), 0) / hadir.length) : null;
  const a = from ? parseDateKey(from) : null;
  const b = to ? parseDateKey(to) : null;
  $('rekap-title').textContent = a && b && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear() ? `Rekap ${NAMA_BULAN[b.getMonth()]}` : 'Rekap';
  $('metrics-period').textContent = periodLabel(from, to);
  $('tl-hadir').textContent = hadir.length;
  $('tl-hadir-sub').textContent = `kehadiran · ${new Set(hadir.map((r) => r.personId)).size} orang, ${new Set(hadir.map((r) => r.date)).size} hari`;
  $('tl-telat').textContent = telat;
  $('tl-telat-sub').textContent = `terlambat · ${hadir.length ? Math.round((telat / hadir.length) * 100) : 0}% dari kehadiran`;
  $('tl-rata').textContent = avg == null ? '—' : `${String(Math.floor(avg / 60)).padStart(2, '0')}.${String(avg % 60).padStart(2, '0')}`;
  $('tl-jam').textContent = Math.round(totalMenit / 60);

  renderCalendar(rows, from, to);
  renderSheet(rows, from, to, orang);

  $('tb-ringkas').innerHTML = summary.length ? summary.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.division || '—')}</td><td class="num">${s.hadir}</td><td class="num ${s.terlambat ? 'late-text' : ''}">${s.terlambat}</td><td class="num">${s.pulangAwal}</td><td class="num">${s.rataMasuk ? titik(s.rataMasuk) : '—'}</td><td class="num">${formatDurasi(s.totalMenit)}</td></tr>`).join('')
    : '<tr><td class="empty" colspan="7">Belum ada data absensi pada rentang tanggal ini.</td></tr>';

  const logRows = state.rekapDay ? rows.filter((r) => r.date === state.rekapDay) : rows;
  $('log-title').textContent = state.rekapDay ? `Log ${tanggalPendek(state.rekapDay)}` : 'Log harian';
  $('log-count').textContent = `${logRows.length} baris`;
  $('tb-log').innerHTML = logRows.length ? logRows.map((r) => {
    const tags = [];
    if (!r.masuk) tags.push('<span class="tag late">tanpa absen masuk</span>');
    else if (r.status === 'terlambat') tags.push('<span class="tag late">terlambat</span>');
    else tags.push('<span class="tag ok">tepat waktu</span>');
    if (r.pulangAwal) tags.push('<span class="tag warn">pulang awal</span>');
    else if (r.masuk && !r.pulang) tags.push('<span class="tag info">belum pulang</span>');
    return `<tr><td>${tanggalPendek(r.date)}</td><td>${esc(r.name)}</td><td class="num ${r.status === 'terlambat' ? 'late-text' : ''}">${r.masuk ? jam(new Date(r.masuk)) : '—'}</td><td class="num">${r.pulang ? jam(new Date(r.pulang)) : '—'}</td><td class="num">${formatDurasi(r.durasi)}</td><td>${tags.join('')}</td></tr>`;
  }).join('') : `<tr><td class="empty" colspan="6">${state.rekapDay ? 'Tidak ada absen pada tanggal ini.' : 'Belum ada data absensi pada rentang tanggal ini.'}</td></tr>`;
}

function periodLabel(from, to) {
  if (!from || !to) return '—';
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()}–${b.getDate()} ${NAMA_BULAN[b.getMonth()]} ${b.getFullYear()}`;
  return `${tanggalPendek(from)} – ${tanggalPendek(to)}`;
}

function renderCalendar(rows, from, to) {
  if (!state.calMonth) {
    const d = parseDateKey(to || state.today);
    state.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  }
  const y = state.calMonth.getFullYear();
  const m = state.calMonth.getMonth();
  $('cal-month').textContent = `${NAMA_BULAN[m]} ${y}`;
  const byDate = new Map();
  for (const r of rows) {
    if (!r.masuk) continue;
    const s = byDate.get(r.date) || { h: 0, t: 0 };
    s.h += 1;
    if (r.status === 'terlambat') s.t += 1;
    byDate.set(r.date, s);
  }
  const libur = state.settings.hariLibur || [0];
  let html = [1, 2, 3, 4, 5, 6, 0].map((d) => `<span class="wd">${HARI_SINGKAT[d]}</span>`).join('');
  html += '<span></span>'.repeat((new Date(y, m, 1).getDay() + 6) % 7);
  const days = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, m, d);
    const key = dateKey(date);
    const s = byDate.get(key);
    const inRange = (!from || key >= from) && (!to || key <= to) && key <= state.today;
    const off = !inRange || (libur.includes(date.getDay()) && !s);
    const cls = ['day', off ? 'off' : '', key === state.today ? 'today' : '', key === state.rekapDay ? 'sel' : ''].filter(Boolean).join(' ');
    const label = `${d} ${NAMA_BULAN[m]}: ${s ? `${s.h} hadir, ${s.t} terlambat` : 'tidak ada absen'}`;
    html += `<button type="button" class="${cls}" data-day="${key}" ${off ? 'disabled' : ''} aria-label="${esc(label)}" aria-pressed="${key === state.rekapDay}">${d}${s ? `<i class="${s.t ? 'late' : ''}"></i>` : ''}</button>`;
  }
  $('cal').innerHTML = html;
  if (state.rekapDay) {
    const s = byDate.get(state.rekapDay) || { h: 0, t: 0 };
    $('cal-foot-title').textContent = formatTanggal(parseDateKey(state.rekapDay));
    $('cal-foot-sub').textContent = `${s.h} hadir · ${s.t} terlambat`;
    $('cal-clear').hidden = false;
  } else {
    $('cal-foot-title').textContent = 'Semua tanggal';
    $('cal-foot-sub').textContent = 'Pilih tanggal untuk melihat log hari itu';
    $('cal-clear').hidden = true;
  }
}

function renderSheet(rows, from, to, orang) {
  const box = $('sheet');
  if (!from || !to) { box.innerHTML = '<p class="note">Pilih rentang tanggal.</p>'; return; }
  const people = orang ? state.people.filter((p) => p.id === orang) : state.people;
  const sheet = buildSheet(rows, people, from, to, state.settings.hariLibur || [0], state.today);
  if (!sheet.people.length) { box.innerHTML = '<p class="note">Belum ada karyawan.</p>'; return; }
  const head = sheet.dates.map((d) => `<th class="${d.libur ? 'wk' : ''}" title="${esc(tanggalPendek(d.key))}">${d.day}<small>${HARI_SINGKAT[d.dow].slice(0, 2)}</small></th>`).join('');
  const body = sheet.people.map((p) => {
    const cells = p.cells.map((c, i) => {
      const d = sheet.dates[i];
      const r = c.row;
      const tip = r ? `${tanggalPendek(d.key)} · masuk ${r.masuk ? jam(new Date(r.masuk)) : '—'} · pulang ${r.pulang ? jam(new Date(r.pulang)) : '—'}` : tanggalPendek(d.key);
      const mark = c.v === 'H' || c.v === 'T' || c.v === 'A' ? `<i class="mk mk-${c.v}">${c.v}</i>` : '';
      return `<td class="c ${c.v === 'L' ? 'libur' : ''}" title="${esc(tip)}">${mark}</td>`;
    }).join('');
    return `<tr><td class="nm" title="${esc(p.name)}">${esc(p.name)}</td>${cells}<td class="tot first">${p.H}</td><td class="tot t ${p.T ? 'has' : ''}">${p.T}</td><td class="tot">${p.A}</td></tr>`;
  }).join('');
  box.innerHTML = `<table class="sheet"><thead><tr><th class="nm"></th>${head}<th class="tot first">H</th><th class="tot">T</th><th class="tot">A</th></tr></thead><tbody>${body}</tbody></table>`
    + (sheet.truncated ? '<p class="note sheet-note">Lembar hadir menampilkan 62 hari pertama. Persempit rentang tanggal untuk melihat sisanya.</p>' : '');
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
  toast(`${name} diunduh.`);
}

// ---------------- Pengaturan ----------------

function buildLiburChips() {
  const order = [1, 2, 3, 4, 5, 6, 0];
  $('libur-chips').innerHTML = order.map((d) => `<label class="chip"><input type="checkbox" name="hariLibur" value="${d}"><span>${HARI_SINGKAT[d]}</span></label>`).join('');
}

function applySettingsUI() {
  const s = state.settings;
  $('place-name').textContent = s.namaTempat || 'Kantor Saya';
  document.title = `Hadir · ${s.namaTempat || 'Absensi Wajah'}`;
  $('clock-rule').innerHTML = `<span class="rule-chip">Masuk <b>${esc(titik(s.jamMasuk))}</b></span><span class="rule-chip">Toleransi <b>${esc(String(s.toleransi))} mnt</b></span><span class="rule-chip">Pulang <b>${esc(titik(s.jamPulang))}</b></span>`;
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
  $('set-suara').value = s.suara === 'mati' || s.suara === 'sapaan' ? s.suara : 'bip';
  $('set-sheets').value = s.sheetsUrl;
  const libur = s.hariLibur || [0];
  document.querySelectorAll('input[name="hariLibur"]').forEach((c) => { c.checked = libur.includes(Number(c.value)); });
}

function renderPinNote() {
  const note = $('pin-note');
  if (state.settings.pinHash) {
    note.innerHTML = 'PIN aktif. Isi PIN baru untuk mengganti, atau <button type="button" class="linklike" id="btn-pin-off">matikan PIN</button>.';
    $('btn-pin-off').addEventListener('click', async () => {
      state.settings.pinHash = '';
      await db.saveSettings({ pinHash: '' });
      renderPinNote();
      toast('PIN admin dimatikan.');
    });
  } else {
    note.textContent = 'Bila diisi, menu selain Absen meminta PIN.';
  }
}

function bindSettings() {
  const form = $('settings-form');
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('change', async (e) => {
    const t = e.target;
    if (!t.name) return;
    let key = t.name;
    let v = t.value;
    if (key === 'hariLibur') v = [...document.querySelectorAll('input[name="hariLibur"]:checked')].map((c) => Number(c.value));
    if (['toleransi', 'jedaMinimal'].includes(key)) v = Math.max(0, parseInt(v, 10) || 0);
    if (key === 'ambang') v = Number(v);
    if (key === 'sheetsUrl') v = String(v).trim();
    state.settings[key] = v;
    await db.saveSettings({ [key]: v });
    applySettingsUI();
    $('save-state').textContent = `Tersimpan pukul ${jam(new Date())}.`;
    if (key === 'sheetsUrl') retryUnsynced();
  });
  $('set-ambang').addEventListener('input', (e) => { $('ambang-out').textContent = Number(e.target.value).toFixed(2).replace('.', ','); });
  $('set-pin').addEventListener('change', async (e) => {
    e.stopPropagation();
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
    const data = { app: 'hadir', version: 2, exportedAt: new Date().toISOString(), settings, people: await db.getAll('people'), logs: await db.getAll('logs') };
    download(`cadangan-hadir-${dateKey(new Date())}.json`, JSON.stringify(data), 'application/json');
  });

  $('file-restore').addEventListener('change', async (e) => {
    e.stopPropagation();
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (err) { toast('File bukan cadangan yang valid.'); return; }
    if (data.app !== 'hadir' || !Array.isArray(data.people) || !Array.isArray(data.logs)) { toast('File ini bukan cadangan dari Hadir.'); return; }
    const ok = await ask({ title: 'Pulihkan cadangan?', body: `Data di perangkat ini diganti dengan ${data.people.length} karyawan dan ${data.logs.length} log dari cadangan.`, okText: 'Pulihkan', danger: true });
    if (!ok) return;
    await db.clear('people');
    await db.clear('logs');
    await db.putMany('people', data.people);
    await db.putMany('logs', data.logs);
    if (data.settings) {
      const { wajibKedip, ...rest } = data.settings;
      await db.saveSettings({ ...rest, pinHash: state.settings.pinHash });
    }
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

// ---------------- Dialog + snackbar ----------------

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
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------------- PWA ----------------

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker gagal:', err));
  }
}
