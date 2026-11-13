// Draws the app icons (original art: a gold crest with an open spellbook under a star on night indigo)
// and writes them into public/. Run with: npm run icons -w @arcane/client
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const NIGHT = '#17112e';
const GOLD = '#e8b54a';
const PARCHMENT = '#f6efe0';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** The emblem on a 512 grid; `scale` shrinks it about the centre so maskable icons keep it in the safe zone. */
function emblem(scale) {
  return `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="M256 52 418 104v128c0 112-72 182-162 228C166 414 94 344 94 232V104Z" fill="${NIGHT}" stroke="${GOLD}" stroke-width="16" stroke-linejoin="round"/>
    <path d="M256 74 398 120v112c0 98-62 160-142 202-80-42-142-104-142-202V120Z" fill="none" stroke="${GOLD}" stroke-opacity=".35" stroke-width="4"/>
    <path d="M256 112l14 38 40 2-31 25 11 39-34-22-34 22 11-39-31-25 40-2Z" fill="${GOLD}"/>
    <path d="M256 268c-30-20-66-26-104-22v118c38-4 74 2 104 22Z" fill="${PARCHMENT}"/>
    <path d="M256 268c30-20 66-26 104-22v118c-38-4-74 2-104 22Z" fill="${PARCHMENT}"/>
    <path d="M256 268v118" stroke="${GOLD}" stroke-width="6" stroke-linecap="round"/>
    <path d="M176 280c24-2 46 2 64 12M176 306c24-2 46 2 64 12M176 332c24-2 46 2 64 12M336 280c-24-2-46 2-64 12M336 306c-24-2-46 2-64 12M336 332c-24-2-46 2-64 12" stroke="#b9a37a" stroke-width="6" stroke-linecap="round" fill="none"/>
    <circle cx="186" cy="200" r="5" fill="${PARCHMENT}" opacity=".8"/>
    <circle cx="330" cy="190" r="4" fill="${PARCHMENT}" opacity=".7"/>
    <circle cx="214" cy="160" r="3" fill="${PARCHMENT}" opacity=".6"/>
  </g>`;
}

function svg({ scale, rounded }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="glow" cx="50%" cy="42%" r="60%">
      <stop offset="0" stop-color="#3a2a6e"/>
      <stop offset="1" stop-color="${NIGHT}"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#glow)"/>
  ${emblem(scale)}
</svg>`;
}

function png(source, size, file) {
  const data = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(out, file), data);
  console.log('wrote', file);
}

const plain = svg({ scale: 1, rounded: false });
// Maskable icons are cropped to a circle of 80% diameter, so the emblem shrinks to fit inside it.
const maskable = svg({ scale: 0.74, rounded: false });

writeFileSync(join(out, 'icon.svg'), svg({ scale: 1, rounded: true }) + '\n');
png(plain, 192, 'icon-192.png');
png(plain, 512, 'icon-512.png');
png(maskable, 512, 'icon-maskable-512.png');
png(plain, 180, 'apple-touch-icon.png');
