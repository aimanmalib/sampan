// Draws the link preview picture (web/public/<site.ogImage>, 1200 x 630) from the same sampan drawing the page shows.
// Run after the drawing, the headline or the colours change: `npm run og-image`. The result is committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { pngSize } from '../core/page-meta.js';
import { SceneArt } from '../web/src/SceneArt.js';

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_BYTES = 300 * 1024;

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const en = JSON.parse(read('lang/en.json')) as Record<string, string>;
const config = JSON.parse(read('config/sampan.json')) as { site: { url: string; ogImage: string } };
const styles = read('web/src/styles.css');
const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const art = renderToStaticMarkup(createElement(SceneArt, { viewBox: '0 60 640 110' }));
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${styles}
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: var(--paper); }
  .og { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; }
  .og__text { padding: 64px 80px 0; }
  .og__host { font: 600 26px var(--font-text); color: var(--river); letter-spacing: 0.02em; }
  .og__title { margin: 20px 0 0; max-width: 900px; font: 600 76px/1.05 var(--font-display); color: var(--ink); }
  .og__art { margin-top: auto; }
  .og__art svg { display: block; width: 100%; height: auto; }
</style></head><body><main class="og">
  <div class="og__text">
    <div class="og__host">${escape(new URL(config.site.url).host)}</div>
    <h1 class="og__title">${escape(en['hero.title'] ?? '')}</h1>
  </div>
  <div class="og__art">${art}</div>
</main></body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.setContent(html);
  const png = await page.screenshot({ type: 'png' });
  const size = pngSize(png);
  if (size.width !== WIDTH || size.height !== HEIGHT) throw new Error(`picture is ${size.width} x ${size.height}`);
  if (png.length > MAX_BYTES) throw new Error(`picture is ${png.length} bytes, over ${MAX_BYTES}`);
  const out = new URL(`../web/public${config.site.ogImage}`, import.meta.url);
  writeFileSync(out, png);
  console.log(`wrote ${out.pathname.split('/').slice(-3).join('/')}: ${png.length} bytes`);
} finally {
  await browser.close();
}
