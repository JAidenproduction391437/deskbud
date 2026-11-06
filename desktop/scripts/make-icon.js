// Draws the Desk Bud icon as PNGs with no image libraries. Run: node scripts/make-icon.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BLUE = [47, 123, 255, 255];
const WHITE = [255, 255, 255, 255];
const INK = [11, 27, 58, 255];

const insideBody = (x, y) => {
  const halfW = 0.46, halfH = 0.40, r = 0.34;
  const dx = Math.max(Math.abs(x - 0.5) - (halfW - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (halfH - r), 0);
  return dx * dx + dy * dy <= r * r;
};
const insideEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

function colorAt(x, y) {
  for (const cx of [0.335, 0.665]) {
    if (insideEllipse(x, y, cx + 0.015, 0.465, 0.06, 0.06)) return INK;
    if (insideEllipse(x, y, cx, 0.46, 0.115, 0.135)) return WHITE;
  }
  return insideBody(x, y) ? BLUE : null;
}

function render(size) {
  const samples = 4;
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const color = colorAt((px + (sx + 0.5) / samples) / size, (py + (sy + 0.5) / samples) / size);
          if (!color) continue;
          for (let i = 0; i < 3; i++) sum[i] += color[i];
          sum[3] += 255;
        }
      }
      const covered = sum[3] / 255;
      const at = 1 + px * 4;
      for (let i = 0; i < 3; i++) row[at + i] = covered ? Math.round(sum[i] / covered) : 0;
      row[at + 3] = Math.round(sum[3] / (samples * samples));
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(render(size))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = path.join(__dirname, '..');
const outputs = {
  'assets/icon.png': 512,
  'assets/tray.png': 32,
  '../server/public/icon-192.png': 192,
  '../server/public/icon-512.png': 512,
};
for (const [file, size] of Object.entries(outputs)) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, png(size));
}
