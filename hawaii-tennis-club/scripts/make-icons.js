// PWA 아이콘(PNG) 생성 — 홈 화면에 추가할 때 쓰인다.
// 아이폰은 SVG 아이콘을 쓰지 못해서 PNG가 꼭 필요하다. 외부 라이브러리 없이 직접 그려 저장한다.
// 실행: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public');

// ---- PNG 쓰기 ----
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                                   // 필터 없음
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // 8비트
  ihdr[9] = 6;    // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 그리기 (2배로 그린 뒤 줄여 테두리를 매끄럽게) ----
const mix = (a, b, k) => [
  Math.round(a[0] + (b[0] - a[0]) * k),
  Math.round(a[1] + (b[1] - a[1]) * k),
  Math.round(a[2] + (b[2] - a[2]) * k),
];

function pixel(x, y, S) {
  const u = x / S, v = y / S;                 // 0..1
  const cx = 0.5, cy = 0.5;
  const r = Math.hypot(u - cx, v - cy);

  // 바깥은 투명 (둥근 사각형)
  const pad = 0.0, rad = 0.203;               // 104/512
  const dx = Math.max(pad - u, u - (1 - pad), 0);
  const dy = Math.max(pad - v, v - (1 - pad), 0);
  const inx = Math.min(u, 1 - u), iny = Math.min(v, 1 - v);
  if (inx < rad && iny < rad) {
    const d = Math.hypot(rad - inx, rad - iny);
    if (d > rad) return [0, 0, 0, 0];
  }
  if (dx > 0 || dy > 0) return [0, 0, 0, 0];

  // 바탕: 코트 그린 그라데이션
  let c = mix([27, 122, 75], [10, 58, 36], v);

  // 코트 라인
  const lw = 0.014;
  const onBox = (Math.abs(u - 0.168) < lw || Math.abs(u - 0.832) < lw ||
                 Math.abs(v - 0.168) < lw || Math.abs(v - 0.832) < lw) &&
                 u > 0.154 && u < 0.846 && v > 0.154 && v < 0.846;
  const onMid = (Math.abs(u - 0.5) < lw || Math.abs(v - 0.5) < lw) &&
                 u > 0.168 && u < 0.832 && v > 0.168 && v < 0.832;
  if (onBox || onMid) c = mix(c, [255, 255, 255], 0.2);

  // 테니스 공
  const R = 0.2305;                            // 118/512
  if (r <= R) {
    c = [216, 240, 90];
    // 실밥 두 줄 — 공 바깥에 중심을 둔 큰 원의 일부
    const seam = (ox) => Math.abs(Math.hypot(u - (cx + ox), v - cy) - 0.252) < 0.0255;
    if (seam(0.252) || seam(-0.252)) c = [255, 255, 255];
  }
  return [c[0], c[1], c[2], 255];
}

function draw(size) {
  const SS = 2;                                 // 2배 초과표본
  const S = size * SS;
  const big = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = pixel(x + 0.5, y + 0.5, S);
      const i = (y * S + x) * 4;
      big[i] = p[0]; big[i + 1] = p[1]; big[i + 2] = p[2]; big[i + 3] = p[3];
    }
  }
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * S + (x * SS + dx)) * 4;
          r += big[i]; g += big[i + 1]; b += big[i + 2]; a += big[i + 3];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      out[i] = r / n; out[i + 1] = g / n; out[i + 2] = b / n; out[i + 3] = a / n;
    }
  }
  return encodePng(size, size, out);
}

for (const size of [192, 512]) {
  const file = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(file, draw(size));
  console.log('wrote', path.relative(path.join(__dirname, '..'), file), fs.statSync(file).size, 'bytes');
}
