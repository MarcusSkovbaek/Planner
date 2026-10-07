/**
 * Renders the Planner logo to PNG/ICO files used by the app, tray and installer.
 * Run with `node scripts/generate-icons.mjs` after changing the artwork; the output
 * is committed so builds do not need a browser.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const logo = (grey = false) => {
  const [from, to] = grey ? ['#9a9aa8', '#6b6b78'] : ['#7b7bf2', '#4646c6'];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="32" height="32" rx="8.5" fill="url(#g)"/>
  <rect x="7" y="8" width="11" height="4.2" rx="2.1" fill="#fff"/>
  <rect x="7" y="14" width="18" height="4.2" rx="2.1" fill="#fff" fill-opacity="0.92"/>
  <rect x="13" y="20" width="12" height="4.2" rx="2.1" fill="#fff" fill-opacity="0.7"/>
</svg>`;
};

/** Small sizes get slightly thicker bars and less rounding so they stay crisp in the tray. */
const trayLogo = (grey = false) => {
  const [from, to] = grey ? ['#9a9aa8', '#6b6b78'] : ['#7373ee', '#4a4acb'];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="16" height="16" rx="3.6" fill="url(#g)"/>
  <rect x="3" y="3.5" width="6" height="2.4" rx="1.2" fill="#fff"/>
  <rect x="3" y="6.8" width="10" height="2.4" rx="1.2" fill="#fff"/>
  <rect x="6.5" y="10.1" width="6.5" height="2.4" rx="1.2" fill="#fff" fill-opacity="0.8"/>
</svg>`;
};

async function render(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** Packs PNG images into a Windows .ico container (PNG-compressed entries, Vista+). */
function toIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const write = (rel, data) => {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log('wrote', rel, data.length, 'bytes');
};

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

const appSizes = [16, 24, 32, 48, 64, 128, 256];
const appImages = [];
for (const size of appSizes) appImages.push({ size, png: await render(page, size <= 24 ? trayLogo() : logo(), size) });
write('build/icon.ico', toIco(appImages));
write('build/icon.png', await render(page, logo(), 512));
write('resources/icon.png', await render(page, logo(), 256));

for (const [name, grey] of [
  ['tray', false],
  ['tray-paused', true],
]) {
  const sizes = [16, 20, 24, 32, 40, 48];
  const images = [];
  for (const size of sizes) images.push({ size, png: await render(page, size <= 24 ? trayLogo(grey) : logo(grey), size) });
  write(`resources/${name}.ico`, toIco(images));
  write(`resources/${name}.png`, await render(page, trayLogo(grey), 32));
}

await browser.close();
