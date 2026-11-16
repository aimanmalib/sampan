// Takes the README pictures from the running site (default: the live site) with the same Playwright the e2e tests use.
// Desktop Chromium 1440 x 900 and WebKit iPhone 13: the home page, every action tab the site shows right now (a tab exists only
// while its feature flag is on, so the pictures never show a flow that is off) and the home page in Malay for README.ms.md.
// Run: `npx tsx tools/readme/shots.ts [site-url]`. A page that logs a console error is refused, not pictured. Results are committed.
import { writeFileSync, rmSync } from 'node:fs';
import { chromium, devices, webkit, type Browser, type BrowserContextOptions, type Page } from 'playwright';

const SITE = new URL(process.argv[2] ?? 'https://sampan.sasateguh.com');
const SETTLE_MS = 3000;
const MAX_BYTES = 400 * 1024;
const JPEG_QUALITY = 85;
const OUT = new URL('../../docs/images/', import.meta.url);

/** Opens a path, waits for the network to go quiet and the page to settle, and fails on any console error. */
async function open(page: Page, path: string, errors: string[]): Promise<void> {
  errors.length = 0;
  await page.goto(new URL(path, SITE).href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(SETTLE_MS);
  if (errors.length) throw new Error(`${path}: console errors: ${errors.join(' | ')}`);
}

/** Writes PNG when it fits the size budget, otherwise JPEG; removes the other format so one file per name stays. */
async function save(page: Page, name: string): Promise<void> {
  const png = await page.screenshot({ type: 'png' });
  const [ext, bytes] = png.length <= MAX_BYTES ? ['png', png] : ['jpg', await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY })];
  if (bytes.length > MAX_BYTES) throw new Error(`${name}: ${bytes.length} bytes, over ${MAX_BYTES}`);
  rmSync(new URL(`${name}.${ext === 'png' ? 'jpg' : 'png'}`, OUT), { force: true });
  writeFileSync(new URL(`${name}.${ext}`, OUT), bytes);
  console.log(`wrote docs/images/${name}.${ext}: ${bytes.length} bytes`);
}

async function shoot(browser: Browser, device: string, options: BrowserContextOptions, withTabs: boolean): Promise<void> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await open(page, '/', errors);
    await save(page, `home-${device}`);
    if (withTabs) {
      const ids = await page.locator('[role="tab"]').evaluateAll((tabs) => tabs.map((t) => t.id.replace(/^tab-/, '')));
      for (const id of ids.slice(1)) {
        await page.locator(`#tab-${id}`).click();
        await page.waitForTimeout(SETTLE_MS);
        if (errors.length) throw new Error(`tab ${id}: console errors: ${errors.join(' | ')}`);
        await save(page, `tab-${id}-${device}`);
      }
    }
    await open(page, '/', errors);
    await page.locator('button[lang="ms"]').click();
    await page.waitForTimeout(SETTLE_MS);
    if (errors.length) throw new Error(`Malay: console errors: ${errors.join(' | ')}`);
    await save(page, `home-ms-${device}`);
  } finally {
    await context.close();
  }
}

const desktop = await chromium.launch();
try {
  await shoot(desktop, 'desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, true);
} finally {
  await desktop.close();
}
const phone = await webkit.launch();
try {
  await shoot(phone, 'iphone', { ...devices['iPhone 13'] }, false);
} finally {
  await phone.close();
}
