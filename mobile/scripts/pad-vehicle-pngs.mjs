import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(__dirname, '..', 'assets');

const files = fs
  .readdirSync(assets)
  .filter((f) => /^vehicle-taxi-(blanc|noir|rouge|bleu|vert|gris|orange)\.png$/i.test(f));

const OUT = 160;
const INNER = 110; // voiture plus petite → marge autour (évite coupe moitié)

for (const file of files) {
  const input = path.join(assets, file);
  const resized = await sharp(input)
    .resize(INNER, INNER, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: OUT,
      height: OUT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: resized,
        left: Math.floor((OUT - INNER) / 2),
        top: Math.floor((OUT - INNER) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(input + '.tmp.png');

  fs.renameSync(input + '.tmp.png', input);
  console.log('padded', file);
}
console.log('ok', files.length);
