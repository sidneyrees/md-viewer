// Generates build/icon.png (512x512): a blue rounded square with a white "M" and a down arrow.
// No dependencies: rasterizes the shapes with supersampling and writes the PNG by hand.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZE = 512;
const SS = 3; // supersampling per axis

const inRoundedRect = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), SIZE - r);
  const cy = Math.min(Math.max(y, r), SIZE - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

const inPolygon = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const LETTER_M = [
  [84, 352], [84, 160], [128, 160], [176, 244], [224, 160], [268, 160], [268, 352],
  [228, 352], [228, 228], [190, 296], [162, 296], [124, 228], [124, 352],
];
const ARROW = [
  [340, 160], [384, 160], [384, 262], [424, 262], [362, 352], [300, 262], [340, 262],
];

function pixel(x, y) {
  if (!inRoundedRect(x, y, 104)) return [0, 0, 0, 0];
  if (inPolygon(x, y, LETTER_M) || inPolygon(x, y, ARROW)) return [255, 255, 255, 255];
  const t = y / SIZE; // vertical gradient
  return [Math.round(31 + 20 * t), Math.round(111 - 30 * t), Math.round(235 - 20 * t), 255];
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const p = pixel(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        // premultiplied accumulation so edges blend cleanly
        acc[0] += p[0] * p[3];
        acc[1] += p[1] * p[3];
        acc[2] += p[2] * p[3];
        acc[3] += p[3];
      }
    }
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    if (acc[3] > 0) {
      raw[o] = Math.round(acc[0] / acc[3]);
      raw[o + 1] = Math.round(acc[1] / acc[3]);
      raw[o + 2] = Math.round(acc[2] / acc[3]);
    }
    raw[o + 3] = Math.round(acc[3] / (SS * SS));
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(import.meta.dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('Wrote ' + out + ' (' + png.length + ' bytes)');
