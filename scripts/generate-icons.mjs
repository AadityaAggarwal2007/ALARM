import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const OUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "icons"
);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // no per-scanline filter
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const BG = [11, 15, 25];
const RED = [239, 68, 68];
const WHITE = [248, 250, 252];

function draw(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);

  const face = size * 0.34;
  const ring = size * 0.4;

  if (dist <= face) {
    // Clock hands: one pointing up, one pointing right.
    const thickness = size * 0.028;
    const upHand =
      Math.abs(dx) <= thickness && dy <= 0 && dy >= -size * 0.22;
    const rightHand =
      Math.abs(dy) <= thickness && dx >= 0 && dx <= size * 0.16;
    if (upHand || rightHand) return [...WHITE, 255];
    return [...RED, 255];
  }

  if (dist <= ring) {
    // Two bells poking out of the top corners.
    const angle = Math.atan2(dy, dx);
    const bellLeft = Math.abs(angle - -2.3) < 0.42;
    const bellRight = Math.abs(angle - -0.84) < 0.42;
    if (bellLeft || bellRight) return [...RED, 255];
  }

  return [...BG, 255];
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [180, 192, 512]) {
  writeFileSync(path.join(OUT_DIR, `icon-${size}.png`), encodePng(size, draw));
  console.log(`wrote icon-${size}.png`);
}
