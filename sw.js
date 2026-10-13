// Service worker: simpan aplikasi + model wajah supaya layar absen tetap jalan saat internet putus.
const CACHE = 'hadir-v6';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './face.js',
  './glasses.js',
  './dicebear.js',
  './logic.js',
  './sheets.js',
  './face-api.esm.js',
  './tfjs-backend-wasm.wasm',
  './tfjs-backend-wasm-simd.wasm',
  './tiny_face_detector_model-weights_manifest.json',
  './tiny_face_detector_model.bin',
  './face_landmark_68_model-weights_manifest.json',
  './face_landmark_68_model.bin',
  './face_recognition_model-weights_manifest.json',
  './face_recognition_model.bin',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './google-sans-flex.woff2'
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
