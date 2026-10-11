// Service worker: simpan aplikasi + model wajah supaya layar absen tetap jalan saat internet putus.
const CACHE = 'hadir-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/face.js',
  './js/logic.js',
  './js/sheets.js',
  './vendor/face-api/face-api.esm.js',
  './vendor/face-api/tfjs-backend-wasm.wasm',
  './vendor/face-api/tfjs-backend-wasm-simd.wasm',
  './models/tiny_face_detector_model-weights_manifest.json',
  './models/tiny_face_detector_model.bin',
  './models/face_landmark_68_model-weights_manifest.json',
  './models/face_landmark_68_model.bin',
  './models/face_recognition_model-weights_manifest.json',
  './models/face_recognition_model.bin',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Apps Script (sinkron) selalu lewat jaringan.
  if (url.hostname.endsWith('google.com')) return;

  // Font Google: pakai cache dulu, perbarui di belakang.
  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com')) {
    event.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req).then((res) => { c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // Halaman: jaringan dulu supaya update cepat terlihat, cache saat offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => {
      caches.open(CACHE).then((c) => c.put('./index.html', res.clone()));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  // Aset lain: cache dulu.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
    return res;
  })));
});
