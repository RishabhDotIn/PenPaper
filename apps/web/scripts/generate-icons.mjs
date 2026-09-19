/**
 * Generates the PWA icons without an image dependency.
 *
 * Run with `node scripts/generate-icons.mjs` after changing the mark. The
 * output is committed so Render (and CI) never needs to rasterise anything.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT_DIR = new URL("../public/icons/", import.meta.url);

const COLORS = {
  background: [105, 101, 219], // #6965db, the Excalidraw-measured primary
  paper: [255, 255, 255],
  ink: [105, 101, 219],
  pen: [255, 212, 59], // #ffd43b
};

function roundedRect(x, y, left, top, right, bottom, radius) {
  const nearestX = Math.max(left, Math.min(x, right));
  const nearestY = Math.max(top, Math.min(y, bottom));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

/** Distance from a point to a segment, used for the pen stroke. */
function segmentDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function mix(a, b, t) {
  return a.map((channel, index) => channel + (b[index] - channel) * t);
}

/**
 * Paints one sample in unit coordinates (0..1). Supersampling in `paint` is
 * what keeps the rounded corners from looking like a pixel-art staircase.
 */
function sample(x, y) {
  if (!roundedRect(x, y, 0.04, 0.04, 0.96, 0.96, 0.2)) return null;

  // Paper sheet, slightly rotated for a hand-placed feel.
  const angle = -0.06;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const px = x - 0.5;
  const py = y - 0.5;
  const rx = px * cos - py * sin + 0.5;
  const ry = px * sin + py * cos + 0.5;

  if (roundedRect(rx, ry, 0.27, 0.2, 0.73, 0.8, 0.035)) {
    // Three ruled lines, clipped to the sheet.
    for (const [index, ruleY] of [0.35, 0.47, 0.59].entries()) {
      const end = index === 2 ? 0.6 : 0.66;
      if (Math.abs(ry - ruleY) < 0.014 && rx > 0.34 && rx < end) return COLORS.ink;
    }

    // Pen across the lower-right corner: a capsule plus a triangular nib.
    const distance = segmentDistance(x, y, 0.5, 0.78, 0.78, 0.5);
    if (distance < 0.045) return COLORS.pen;
    if (distance < 0.075 && x > 0.72 && y > 0.72) return COLORS.pen;

    return COLORS.paper;
  }

  // A soft diagonal highlight on the background.
  const sheen = Math.max(0, 0.25 - Math.abs(x + y - 0.55) * 0.5);
  return mix(COLORS.background, [255, 255, 255], sheen);
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;
  const step = 1 / (size * samples);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const color = sample((x * samples + sx + 0.5) * step, (y * samples + sy + 0.5) * step);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 255;
        }
      }

      const total = samples * samples;
      const offset = (y * size + x) * 4;
      pixels[offset] = a === 0 ? 0 : Math.round(r / (a / 255));
      pixels[offset + 1] = a === 0 ? 0 : Math.round(g / (a / 255));
      pixels[offset + 2] = a === 0 ? 0 : Math.round(b / (a / 255));
      pixels[offset + 3] = Math.round(a / total);
    }
  }

  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const size of [180, 192, 512]) {
  const pixels = render(size);
  writeFileSync(new URL(`icon-${size}.png`, OUT_DIR), encodePng(size, pixels));
  console.log(`icons/icon-${size}.png`);
}
