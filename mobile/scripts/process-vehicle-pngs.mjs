import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(__dirname, '..', 'assets');

const files = fs
  .readdirSync(assets)
  .filter((f) => /^vehicle-taxi-(blanc|noir|rouge|bleu|vert|gris|orange)\.png$/i.test(f));

/** Seuil fond noir (flood depuis les bords — préserve carrosserie). */
const THRESH = 22;
const SIZE = 128;

for (const file of files) {
  const input = path.join(assets, file);
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const isBg = (i) => {
    const o = i * 4;
    return data[o] <= THRESH && data[o + 1] <= THRESH && data[o + 2] <= THRESH;
  };

  const visited = new Uint8Array(w * h);
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (visited[i] || !isBg(i)) return;
    visited[i] = 1;
    queue.push(i);
  };

  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }

  while (queue.length) {
    const i = queue.pop();
    data[i * 4 + 3] = 0;
    const x = i % w;
    const y = (i / w) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  const cleared = await sharp(data, {
    raw: { width: w, height: h, channels: 4 },
  })
    .png()
    .toBuffer();

  const tmp = input + '.tmp.png';
  await sharp(cleared)
    .trim({ threshold: 8 })
    .resize(SIZE, SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toFile(tmp);

  fs.renameSync(tmp, input);
  console.log(`OK ${file} (${Math.round(fs.statSync(input).size / 1024)} KB)`);
}

console.log('done', files.length);
