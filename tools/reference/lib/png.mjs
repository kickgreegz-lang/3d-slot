/**
 * Minimal, dependency-free PNG codec (node:zlib only).
 *
 *   decodePng(buf)            -> { width, height, channels: 4, data: Uint8Array RGBA }
 *   encodePng(w, h, rgba)     -> Buffer (8-bit RGBA, filter 0) — used for test fixtures
 *   downsample(img, maxW)     -> { width, height, data: Float32Array RGB } area-averaged
 *
 * Handles what Chromium/ffmpeg/most tools write: 8-bit, non-interlaced, colour types
 * 0 (grey), 2 (RGB), 3 (palette), 4 (grey+alpha), 6 (RGBA). 16-bit and Adam7 are rejected
 * with a clear error (re-encode with ffmpeg if you ever hit that).
 */
import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8;
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      ctype = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (depth !== 8) throw new Error(`PNG bit depth ${depth} not supported (8 only)`);
  if (interlace) throw new Error('interlaced PNG not supported');
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!bpp) throw new Error(`PNG colour type ${ctype} not supported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    switch (f) {
      case 0:
        cur.set(src);
        break;
      case 1:
        for (let i = 0; i < stride; i++) cur[i] = (src[i] + (i >= bpp ? cur[i - bpp] : 0)) & 255;
        break;
      case 2:
        for (let i = 0; i < stride; i++) cur[i] = (src[i] + prev[i]) & 255;
        break;
      case 3:
        for (let i = 0; i < stride; i++) cur[i] = (src[i] + (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1)) & 255;
        break;
      case 4:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          cur[i] = (src[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
        }
        break;
      default:
        throw new Error(`bad PNG filter ${f} on row ${y}`);
    }
    prev = cur;
  }
  if (ctype === 6) return { width, height, channels: 4, data: px };
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    if (ctype === 2) {
      out[j] = px[i * 3]; out[j + 1] = px[i * 3 + 1]; out[j + 2] = px[i * 3 + 2]; out[j + 3] = 255;
    } else if (ctype === 0) {
      out[j] = out[j + 1] = out[j + 2] = px[i]; out[j + 3] = 255;
    } else if (ctype === 4) {
      out[j] = out[j + 1] = out[j + 2] = px[i * 2]; out[j + 3] = px[i * 2 + 1];
    } else {
      const k = px[i];
      out[j] = palette[k * 3]; out[j + 1] = palette[k * 3 + 1]; out[j + 2] = palette[k * 3 + 2];
      out[j + 3] = trns && k < trns.length ? trns[k] : 255;
    }
  }
  return { width, height, channels: 4, data: out };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Area-average an RGBA image down to at most maxW wide. Returns RGB floats (0..255). */
export function downsample(img, maxW) {
  const f = Math.max(1, Math.ceil(img.width / maxW));
  const w = Math.floor(img.width / f), h = Math.floor(img.height / f);
  const out = new Float32Array(w * h * 3);
  const src = img.data, sw = img.width, n = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let yy = 0; yy < f; yy++) {
        let i = ((y * f + yy) * sw + x * f) * 4;
        for (let xx = 0; xx < f; xx++, i += 4) {
          r += src[i]; g += src[i + 1]; b += src[i + 2];
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return { width: w, height: h, factor: f, data: out };
}
