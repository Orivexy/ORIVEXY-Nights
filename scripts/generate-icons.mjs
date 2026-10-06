// Generates every icon/brand image from the logo in scripts/logo.mjs:
// PWA + favicon (public/icons), Windows app icon (.ico, multi-size) and the
// installer's sidebar/header bitmaps (desktop/build). Run: node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { COLORS, iconSvg, markSvg } from "./logo.mjs";

const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
mkdirSync("public/icons", { recursive: true });
mkdirSync("desktop/build", { recursive: true });

// ─── Web / PWA ──────────────────────────────────────────────────────────────
const web = [
  ["public/icons/icon-192.png", 192, {}],
  ["public/icons/icon-512.png", 512, {}],
  // Maskable: full-bleed square, mark inside the safe zone.
  ["public/icons/maskable-512.png", 512, { square: true, padding: 0.22 }],
  ["public/icons/apple-touch-icon.png", 180, { square: true, padding: 0.16 }],
  ["public/icons/favicon-32.png", 32, { simple: true, padding: 0.06 }],
];
for (const [file, size, opts] of web) writeFileSync(file, await png(iconSvg(size, opts), size));
writeFileSync("public/icons/logo-mark.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${markSvg()}</svg>`);

// ─── Windows app icon (.ico with PNG images, Vista+) ────────────────────────
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(icoSizes.map((s) => png(iconSvg(s, s <= 32 ? { simple: true, padding: 0.04 } : s <= 64 ? { simple: true, padding: 0.08 } : {}), s)));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((img, i) => {
  const e = Buffer.alloc(16);
  const s = icoSizes[i];
  e.writeUInt8(s >= 256 ? 0 : s, 0);
  e.writeUInt8(s >= 256 ? 0 : s, 1);
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(img.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += img.length;
  return e;
});
writeFileSync("desktop/build/icon.ico", Buffer.concat([header, ...entries, ...images]));
writeFileSync("desktop/build/icon.png", await png(iconSvg(1024), 1024));

// ─── Installer bitmaps (NSIS needs 24-bit BMP) ──────────────────────────────
async function bmp(svg, width, height) {
  const { data } = await sharp(Buffer.from(svg)).resize(width, height).flatten({ background: COLORS.ink }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 3;
      const dst = (height - 1 - y) * rowSize + x * 3; // bottom-up, BGR
      pixels[dst] = data[src + 2];
      pixels[dst + 1] = data[src + 1];
      pixels[dst + 2] = data[src];
    }
  }
  const file = Buffer.alloc(54);
  file.write("BM", 0);
  file.writeUInt32LE(54 + pixels.length, 2);
  file.writeUInt32LE(54, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  file.writeUInt32LE(pixels.length, 34);
  file.writeInt32LE(2835, 38);
  file.writeInt32LE(2835, 42);
  return Buffer.concat([file, pixels]);
}

const sky = `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#23104f"/><stop offset="0.6" stop-color="#0d0a24"/><stop offset="1" stop-color="${COLORS.ink}"/></linearGradient>
    <radialGradient id="h1" cx="0.1" cy="0.95" r="0.8"><stop offset="0" stop-color="${COLORS.magenta}" stop-opacity="0.5"/><stop offset="1" stop-color="${COLORS.magenta}" stop-opacity="0"/></radialGradient>
    <radialGradient id="h2" cx="0.95" cy="0.05" r="0.7"><stop offset="0" stop-color="${COLORS.violet}" stop-opacity="0.55"/><stop offset="1" stop-color="${COLORS.violet}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/><rect width="100%" height="100%" fill="url(#h1)"/><rect width="100%" height="100%" fill="url(#h2)"/>`;
const stars = (pts) => pts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="0.7"/>`).join("");

const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  ${sky}
  ${stars([[18, 22, 1], [140, 40, 0.8], [30, 150, 0.7], [150, 180, 0.9], [22, 270, 0.8], [120, 290, 0.7], [70, 30, 0.6]])}
  <svg x="22" y="70" width="120" height="120" viewBox="0 0 100 100">${markSvg()}</svg>
  <text x="82" y="218" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="25" fill="#fff">ORIVEXY</text>
  <text x="84" y="238" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="13" letter-spacing="5" fill="${COLORS.volt}">NIGHTS</text>
  <text x="82" y="262" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#fff" opacity="0.8">la noche empieza aquí</text>
</svg>`;
const headerImg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  ${sky}
  <svg x="6" y="4" width="49" height="49" viewBox="0 0 100 100">${markSvg({ glow: false })}</svg>
  <text x="58" y="29" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="17" fill="#fff">ORIVEXY</text>
  <text x="59" y="45" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="9" letter-spacing="3.4" fill="${COLORS.volt}">NIGHTS</text>
</svg>`;
writeFileSync("desktop/build/installerSidebar.bmp", await bmp(sidebar, 164, 314));
writeFileSync("desktop/build/uninstallerSidebar.bmp", await bmp(sidebar, 164, 314));
writeFileSync("desktop/build/installerHeader.bmp", await bmp(headerImg, 150, 57));
console.log("icons ok");
