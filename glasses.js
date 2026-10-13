// Kacamata sintetis untuk augmentasi pendaftaran.
// Wajah yang didaftarkan tanpa kacamata ikut disimpan dalam beberapa versi "berkacamata",
// supaya karyawan tetap dikenali saat datang memakai kacamata.

// lensW: lebar lensa relatif lebar mata · lensH: tinggi relatif lebar lensa
// stroke: tebal bingkai relatif lebar mata · radius: kelengkungan sudut (0 kotak, 0.5 bulat)
export const GLASSES_STYLES = [
  { id: 'tipis', lensW: 1.75, lensH: 0.62, stroke: 0.07, radius: 0.22, color: '#151515', tint: 0.05 },
  { id: 'tebal', lensW: 1.9, lensH: 0.7, stroke: 0.2, radius: 0.32, color: '#0c0c0c', tint: 0.08 },
  { id: 'bulat', lensW: 1.7, lensH: 0.92, stroke: 0.06, radius: 0.5, color: '#6f6250', tint: 0.04 }
];

const mean = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// Gambar kacamata di atas wajah. pts = 68 titik wajah (koordinat kanvas).
export function drawGlasses(ctx, pts, style) {
  const left = pts.slice(36, 42);
  const right = pts.slice(42, 48);
  const cL = mean(left);
  const cR = mean(right);
  const eyeW = (dist(pts[36], pts[39]) + dist(pts[42], pts[45])) / 2;
  const d = dist(cL, cR);
  if (!eyeW || !d) return;
  const angle = Math.atan2(cR.y - cL.y, cR.x - cL.x);
  const mid = { x: (cL.x + cR.x) / 2, y: (cL.y + cR.y) / 2 };
  const W = Math.min(eyeW * style.lensW, d * 0.94);
  const H = W * style.lensH;
  const dy = H * 0.08;
  const lw = Math.max(1, eyeW * style.stroke);
  const r = Math.min(W, H) * style.radius;

  // Titik rahang dalam koordinat kacamata, untuk ujung gagang.
  const toLocal = (p) => {
    const x = p.x - mid.x, y = p.y - mid.y;
    return { x: x * Math.cos(-angle) - y * Math.sin(-angle), y: x * Math.sin(-angle) + y * Math.cos(-angle) };
  };
  const jawL = toLocal(pts[0]);
  const jawR = toLocal(pts[16]);

  ctx.save();
  ctx.translate(mid.x, mid.y);
  ctx.rotate(angle);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const cx of [-d / 2, d / 2]) {
    roundedRect(ctx, cx - W / 2, dy - H / 2, W, H, r);
    ctx.fillStyle = `rgba(255,255,255,${style.tint})`;
    ctx.fill();
    // pantulan cahaya tipis di lensa
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = W * 0.08;
    ctx.beginPath();
    ctx.moveTo(cx - W * 0.35, dy + H * 0.5);
    ctx.lineTo(cx + W * 0.05, dy - H * 0.5);
    ctx.stroke();
    ctx.restore();
    roundedRect(ctx, cx - W / 2, dy - H / 2, W, H, r);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  ctx.strokeStyle = style.color;
  ctx.lineWidth = lw;
  // jembatan hidung
  ctx.beginPath();
  ctx.moveTo(-d / 2 + W / 2, dy - H * 0.18);
  ctx.quadraticCurveTo(0, dy - H * 0.38, d / 2 - W / 2, dy - H * 0.18);
  ctx.stroke();
  // gagang ke arah telinga
  ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  ctx.moveTo(-d / 2 - W / 2, dy - H * 0.3);
  ctx.lineTo(Math.min(jawL.x, -d / 2 - W / 2), dy - H * 0.36);
  ctx.moveTo(d / 2 + W / 2, dy - H * 0.3);
  ctx.lineTo(Math.max(jawR.x, d / 2 + W / 2), dy - H * 0.36);
  ctx.stroke();
  ctx.restore();
}
