// Renders brand/logo.svg (the favicon mark, drawn at 256 x 256) to the PNG sizes the README uses, on a transparent background.
// Run after the mark changes: `npx tsx tools/readme/brand-assets.ts`. The results are committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { pngSize } from '../../core/page-meta.js';

const SIZES = [512, 64];
const svg = readFileSync(new URL('../../brand/logo.svg', import.meta.url), 'utf8');

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const sized = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${sized}</body></html>`);
    const png = await page.screenshot({ type: 'png', omitBackground: true });
    const got = pngSize(png);
    if (got.width !== size || got.height !== size) throw new Error(`logo-${size}.png is ${got.width} x ${got.height}`);
    const out = new URL(`../../brand/logo-${size}.png`, import.meta.url);
    writeFileSync(out, png);
    console.log(`wrote brand/logo-${size}.png: ${png.length} bytes`);
    await page.close();
  }
} finally {
  await browser.close();
}
