import { readFileSync } from 'node:fs';
/** Minimal 24/32-bit BMP reader → {width,height,data: RGBA Uint8ClampedArray} (top-down). */
export function readBmp(path) {
  const b = readFileSync(path);
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), hRaw = b.readInt32LE(22), bpp = b.readUInt16LE(28);
  const h = Math.abs(hRaw), bottomUp = hRaw > 0, bytes = bpp / 8, stride = Math.ceil((w * bytes) / 4) * 4;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = off + (bottomUp ? h - 1 - y : y) * stride;
    for (let x = 0; x < w; x++) {
      const i = row + x * bytes, o = (y * w + x) * 4;
      data[o] = b[i + 2]; data[o + 1] = b[i + 1]; data[o + 2] = b[i]; data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Write a 24-bit BMP (used to save fixtures). */
export async function writeBmp(path, { width, height, data }) {
  const stride = Math.ceil((width * 3) / 4) * 4, size = 54 + stride * height;
  const b = Buffer.alloc(size);
  b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(width, 18); b.writeInt32LE(-height, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4, i = 54 + y * stride + x * 3;
    b[i] = data[o + 2]; b[i + 1] = data[o + 1]; b[i + 2] = data[o];
  }
  (await import('node:fs')).writeFileSync(path, b);
}
