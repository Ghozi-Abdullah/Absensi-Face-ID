// Pembungkus face-api: memuat model, membaca wajah, dan menghitung EAR mata.
import * as faceapi from '../vendor/face-api/face-api.esm.js';
import { eyeAspectRatio } from './logic.js';

let ready = false;
let options = null;

export async function loadModels(base = './models') {
  if (ready) return;
  // WebGL paling cepat; WASM untuk perangkat tanpa WebGL; CPU sebagai jalan terakhir.
  if (faceapi.tf.setWasmPaths) faceapi.tf.setWasmPaths(new URL('../vendor/face-api/', import.meta.url).href);
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
