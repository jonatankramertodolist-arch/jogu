/**
 * Generates the PNG app icons from the same mark as `public/favicon.svg`.
 *
 * iOS ignores SVG for home-screen icons, so real PNGs are needed. Written by
 * hand with zlib rather than pulling in an image library, since the mark is a
 * single flat polygon on a solid background. Run with `npm run icons`.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BACKGROUND = [0x0b, 0x0f, 0x14] as const;
const FOREGROUND = [0x34, 0xd3, 0x99] as const;

/**
 * The lightning bolt from the favicon, as absolute points on its 64x64 canvas.
 * Kept in sync by hand with the `d` attribute in `public/favicon.svg`.
 */
const BOLT: [number, number][] = [
  [34, 8],
  [16, 36],
  [28, 36],
  [26, 56],
  [44, 26],
  [31, 26],
];
const CANVAS = 64;

/** Samples per axis within each pixel, which is what smooths the edges. */
const SUPERSAMPLE = 4;

function isInside(x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = BOLT.length - 1; i < BOLT.length; j = i, i += 1) {
    const [xi, yi] = BOLT[i];
    const [xj, yj] = BOLT[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Share of the pixel at (px, py) covered by the bolt, from 0 to 1. */
function coverage(px: number, py: number, scale: number): number {
  let hits = 0;
  for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
    for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
      const x = (px + (sx + 0.5) / SUPERSAMPLE) / scale;
      const y = (py + (sy + 0.5) / SUPERSAMPLE) / scale;
      if (isInside(x, y)) hits += 1;
    }
  }
  return hits / (SUPERSAMPLE * SUPERSAMPLE);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** An opaque RGB PNG. No alpha, which is what Apple wants for a touch icon. */
function encodePng(size: number, pixels: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  // Remaining bytes stay zero: deflate compression, adaptive filtering, no interlace.

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderIcon(size: number): Buffer {
  const scale = size / CANVAS;
  const pixels = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = coverage(x, y, scale);
      const offset = (y * size + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        pixels[offset + c] = Math.round(BACKGROUND[c] * (1 - alpha) + FOREGROUND[c] * alpha);
      }
    }
  }
  return encodePng(size, pixels);
}

const targets = [
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
];

for (const target of targets) {
  const path = join('public', target.name);
  const png = renderIcon(target.size);
  writeFileSync(path, png);
  console.log(`  ${target.name.padEnd(22)} ${target.size}x${target.size}  ${png.length} byte`);
}

console.log('\nIkonerna är skapade i public/.');
