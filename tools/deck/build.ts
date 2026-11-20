// Prints the event deck to web/public/deck/sampan-blaze-2026.pdf with Playwright Chromium (`page.pdf`): vector text you can
// select, live links, fonts embedded from web/src/fonts, nothing fetched from the network. The site links it from the
// banner (config banner.deckUrl). Run: `npx tsx tools/deck/build.ts [--copy <path>]`. Result is committed.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { slides, slidesHash } from './content.js';
import { pitchFrom } from '../../core/pitch.js';
import { symbolList } from '../../core/flows.js';
import { measuredHeadline } from '../../scripts/measured-json.js';
import { deckHtml } from './html.js';

const root = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const DECK_FILE = 'web/public/deck/sampan-blaze-2026.pdf';
const HASH_FILE = 'tools/deck/printed.sha256';
const MAX_BYTES = 3 * 1024 * 1024;

/** Rewrites the fonts.css url('./x.woff2') references as data: URLs. */
function fontCss(): string {
  const css = readFileSync(root('web/src/fonts/fonts.css'), 'utf8');
  return css.replace(/url\('\.\/([^']+\.woff2)'\)/g, (_m, file: string) => {
    const b64 = readFileSync(root(`web/src/fonts/${file}`)).toString('base64');
    return `url('data:font/woff2;base64,${b64}')`;
  });
}

/** Slide 1 reads the page's pitch.what / pitch.why / pitch.proof (English), with the proof counted from MEASURED. */
function enPitch(symbols: string[]) {
  const en = JSON.parse(readFileSync(root('lang/en.json'), 'utf8')) as Record<string, string>;
  return pitchFrom(en, measuredHeadline(), symbolList(symbols, en['text.and'] ?? 'and'));
}

async function main(): Promise<void> {
  const config = JSON.parse(readFileSync(root('config/sampan.json'), 'utf8')) as {
    site: { url: string };
    banner: { repoUrl: string; tokenAddress: string };
    ui: { theme: string };
    route: { symbols: string[] };
  };
  if (!config.banner.repoUrl) throw new Error('config banner.repoUrl is empty: the deck names the repository');
  const list = slides({
    siteUrl: config.site.url,
    repoUrl: config.banner.repoUrl,
    tokenAddress: config.banner.tokenAddress,
    pitch: enPitch(config.route.symbols),
  });
  const html = deckHtml(list, {
    theme: config.ui.theme,
    themeCss: readFileSync(root(`web/src/themes/${config.ui.theme}.css`), 'utf8'),
    fontCss: fontCss(),
    logoSvg: readFileSync(root('brand/logo.svg'), 'utf8'),
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const outside: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith('data:') && r.url() !== 'about:blank') outside.push(r.url());
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    if (outside.length) throw new Error(`the deck asked the network for ${outside[0]}`);
    const pdf = await page.pdf({ width: '1280px', height: '720px', printBackground: true, preferCSSPageSize: true });
    if (pdf.length > MAX_BYTES) throw new Error(`deck is ${pdf.length} bytes, over ${MAX_BYTES}`);
    mkdirSync(root('web/public/deck'), { recursive: true });
    writeFileSync(root(DECK_FILE), pdf);
    writeFileSync(root(HASH_FILE), `${slidesHash(list)}\n`);
    console.log(`wrote ${DECK_FILE}: ${pdf.length} bytes, ${list.length} slides`);
  } finally {
    await browser.close();
  }
  const copyTo = process.argv[process.argv.indexOf('--copy') + 1];
  if (process.argv.includes('--copy') && copyTo) copyFileSync(root(DECK_FILE), copyTo);
}

await main();
