// Pembungkus face-api: memuat model, membaca wajah, dan menghitung EAR mata.
import * as faceapi from './face-api.esm.js';
import { eyeAspectRatio } from './logic.js';

let ready = false;
let options = null;

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

export function backendName() {
  try { return faceapi.tf.getBackend(); } catch (e) { return '?'; }
}

// Wajah terbesar di frame + 68 titik + descriptor 128 angka.
export async function readFace(video) {
  const r = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
  if (!r) return null;
  return pack(r, video);
}

// Versi ringan tanpa descriptor, untuk mengejar kedipan.
export async function readLandmarks(video) {
  const r = await faceapi.detectSingleFace(video, options).withFaceLandmarks();
  if (!r) return null;
  return pack(r, video);
}

// Semua wajah di sebuah foto (img/canvas). Dipakai untuk pendaftaran dari foto.
// inputSize lebih besar supaya wajah kecil di pas foto atau foto KTP tetap terbaca.
// Beberapa ukuran dicoba bergantian: ukuran besar untuk wajah kecil (foto rombongan),
// ukuran kecil untuk wajah yang memenuhi bingkai (pas foto).
export async function readFacesFromImage(source) {
  let res = [];
  for (const inputSize of [416, 608, 320, 224]) {
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.4 });
    res = await faceapi.detectAllFaces(source, opts).withFaceLandmarks().withFaceDescriptors();
    if (res.length) break;
  }
  return res.map((r) => ({
    box: { x: r.detection.box.x, y: r.detection.box.y, width: r.detection.box.width, height: r.detection.box.height },
    score: r.detection.score,
    descriptor: Array.from(r.descriptor)
  }));
}

function pack(r, video) {
  const box = r.detection.box;
  const lm = r.landmarks;
  const ear = (eyeAspectRatio(lm.getLeftEye()) + eyeAspectRatio(lm.getRightEye())) / 2;
  return {
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    score: r.detection.score,
    ear,
    descriptor: r.descriptor ? Array.from(r.descriptor) : null,
    sizeRatio: box.width / (video.videoWidth || 1)
  };
}
