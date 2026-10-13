// Pembungkus face-api: memuat model, membaca wajah, dan membuat sampel berkacamata.
import * as faceapi from './face-api.esm.js';
import { drawGlasses, GLASSES_STYLES } from './glasses.js';

let ready = false;
let options = null;
const imageOpts = (inputSize) => new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.4 });

export async function loadModels(base = '.') {
  if (ready) return;
  // WebGL paling cepat; WASM untuk perangkat tanpa WebGL; CPU sebagai jalan terakhir.
  if (faceapi.tf.setWasmPaths) faceapi.tf.setWasmPaths(new URL('./', import.meta.url).href);
  for (const name of ['webgl', 'wasm', 'cpu']) {
    try {
      if (await faceapi.tf.setBackend(name)) break;
    } catch (e) { /* coba backend berikutnya */ }
  }
  await faceapi.tf.ready();
  console.info('[hadir] backend TensorFlow.js:', faceapi.tf.getBackend());
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(base),
    faceapi.nets.faceLandmark68Net.loadFromUri(base),
    faceapi.nets.faceRecognitionNet.loadFromUri(base)
  ]);
  options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  ready = true;
}

export function isReady() {
  return ready;
}

function pack(r, sourceWidth) {
  const box = r.detection.box;
  return {
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    score: r.detection.score,
    descriptor: Array.from(r.descriptor),
    points: r.landmarks.positions.map((p) => ({ x: p.x, y: p.y })),
    sizeRatio: box.width / (sourceWidth || 1)
  };
}

// Wajah terbesar di frame kamera + 68 titik + descriptor 128 angka.
export async function readFace(video) {
  const r = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
  return r ? pack(r, video.videoWidth) : null;
}

// Semua wajah di sebuah foto. Beberapa ukuran dicoba bergantian: ukuran besar untuk
// wajah kecil (foto rombongan), ukuran kecil untuk wajah yang memenuhi bingkai (pas foto).
export async function readFacesFromImage(source) {
  let res = [];
  for (const inputSize of [416, 608, 320, 224]) {
    res = await faceapi.detectAllFaces(source, imageOpts(inputSize)).withFaceLandmarks().withFaceDescriptors();
    if (res.length) break;
  }
  return res.map((r) => pack(r, source.width));
}

async function describe(canvas) {
  for (const size of [320, 416, 224]) {
    const r = await faceapi.detectSingleFace(canvas, imageOpts(size)).withFaceLandmarks().withFaceDescriptor();
    if (r) return Array.from(r.descriptor);
  }
  return null;
}

// Buat beberapa versi wajah yang sama dengan kacamata sintetis, lalu ambil descriptor-nya.
// source: kanvas/video berisi wajah · box dan points: hasil deteksi di source itu.
export async function augmentGlasses(source, box, points) {
  const size = 320;
  const s = Math.max(box.width, box.height) * 2.2;
  const sx = box.x + box.width / 2 - s / 2;
  const sy = box.y + box.height / 2 - s / 2;
  const k = size / s;
  const base = document.createElement('canvas');
  base.width = base.height = size;
  base.getContext('2d').drawImage(source, sx, sy, s, s, 0, 0, size, size);
  const pts = points.map((p) => ({ x: (p.x - sx) * k, y: (p.y - sy) * k }));
  const out = [];
  for (const style of GLASSES_STYLES) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    drawGlasses(ctx, pts, style);
    const d = await describe(c);
    if (d) out.push(d);
  }
  return out;
}
