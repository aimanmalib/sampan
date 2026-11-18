// PRD 4.10 first-screen rule on the page the live site shows (the shipped flows: landing flow on, so the judge strip
// is drawn, and crossings as the config file has them):
// without scrolling, the headline, the boat picture with both labelled banks, the judge strip with Fill, the whole card
// (tabs, amount, filled price line and its one primary button) are fully in view, in every language config offers, on an iPhone 13 and two desktop sizes.
// After "Fill this in for me" the primary button is still in view without scrolling.
import { expect, test, type Page } from '@playwright/test';
import shipped from '../config/sampan.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };
import fil from '../lang/fil.json' with { type: 'json' };
import id from '../lang/id.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import vectors from '../tests/fixtures/tambat-vectors.json' with { type: 'json' };
import { E2E_THEME, NOSTR_PORT_OFFSET, PAY_PORT_OFFSET, SHIPPED_PORT_OFFSET } from '../playwright.config.js';
import { answerRelays } from './nostr-relays.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server with the shipped flows');
const shippedPort = Number(process.env.E2E_PORT ?? 4173) + SHIPPED_PORT_OFFSET;
test.use({ baseURL: `http://127.0.0.1:${shippedPort}` });

const FILES: Record<string, typeof en> = { en, ms, id, fil };
const LANGS = Object.fromEntries(shipped.i18n.languages.map((l) => [l.code, FILES[l.code]!]));
const DESKTOP_SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
];

/** Fails unless the element is laid out and lies fully between the top and bottom of the viewport. */
async function inView(page: Page, selector: string, label: string): Promise<void> {
  const height = page.viewportSize()?.height ?? 0;
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${label}: ${selector} is laid out`).not.toBeNull();
  expect(box!.y, `${label}: ${selector} top`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${label}: ${selector} bottom at ${height}px high`).toBeLessThanOrEqual(height);
}

/** With E2E_SHOTS_DIR set, saves the first screen (viewport only) for review. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/sampan-first-screen-${name}.png` });
}

for (const [lang, text] of Object.entries(LANGS)) {
  test(`first screen holds headline, picture, judge strip, tabs and one primary button (${lang})`, async ({ page }, info) => {
    const sizes = info.project.name.includes('desktop') ? DESKTOP_SIZES : [null];
    await page.addInitScript((value) => localStorage.setItem('sampan.lang', value), lang);
    for (const size of sizes) {
      if (size) await page.setViewportSize(size);
      const viewport = page.viewportSize()!;
      const label = `${info.project.name} ${viewport.width}x${viewport.height} ${lang}`;
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', E2E_THEME ?? shipped.ui.theme);
      await expect(page.locator('h1')).toHaveText(text['hero.title']);
      await expect(page.locator('.judge__fill')).toHaveText(text['judge.fill']);
      await expect(page.locator('.button--primary')).toHaveCount(1);
      // Measure the card as a visitor sees it: with the price line filled in (it adds a line once the quote arrives).
      await expect(page.locator('.swap__receive')).toContainText(/\d/, { timeout: 10_000 });
      await expect(page.locator('figure.scene').getByText(text['scene.left'], { exact: true })).toBeVisible();
      await expect(page.locator('figure.scene').getByText(text['scene.right'], { exact: true })).toBeVisible();
      await expect(page.locator('.judge__title')).toHaveText(text['judge.title']);
      for (const selector of ['h1', 'figure.scene', '.judge__title', '.judge__fill', 'section.card', '[role=tablist]', '.button--primary']) {
        await inView(page, selector, label);
      }
      expect(await page.evaluate(() => window.scrollY), `${label}: no scroll`).toBe(0);
      const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(width[0], `${label}: no sideways scroll`).toBeLessThanOrEqual(width[1]!);
      await shot(page, `${info.project.name}-${viewport.width}-${lang}`);

      await page.locator('.judge__fill').click();
      await expect(page.getByRole('tab', { name: text['tabs.in'] })).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.button--primary')).toHaveCount(1);
      await inView(page, '.button--primary', `${label} after Fill`);
      expect(await page.evaluate(() => window.scrollY), `${label}: no scroll after Fill`).toBe(0);
      await shot(page, `${info.project.name}-${viewport.width}-${lang}-filled`);
    }
  });
}

// Sampan Pay (fake server with features.pay on): the shop's heading and its one primary button, and on an invoice
// the heading, the amount and "Open in wallet", are in view without scrolling.
test.describe('Sampan Pay first screens', () => {
  test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + PAY_PORT_OFFSET}` });
  for (const [lang, text] of Object.entries(LANGS)) {
    test(`/pay and /pay/i/:id hold the heading and the one primary button (${lang})`, async ({ page }, info) => {
      await page.addInitScript((value) => localStorage.setItem('sampan.lang', value), lang);
      await page.goto('/pay');
      await expect(page.locator('h1')).toHaveText(text['pay.shop.title']);
      await expect(page.locator('.button--primary')).toHaveCount(1);
      for (const selector of ['h1', '.button--primary']) await inView(page, selector, `${info.project.name} /pay ${lang}`);
      await shot(page, `${info.project.name}-pay-${lang}`);
      await page.locator('.button--primary').click();
      await expect(page.locator('.payinv__bch')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.button--primary')).toHaveCount(1);
      for (const selector of ['h1', '.payinv__bch', '.button--primary']) await inView(page, selector, `${info.project.name} invoice ${lang}`);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await shot(page, `${info.project.name}-invoice-${lang}`);
    });
  }
});

// Nostr identities on (fake server, relays answered by the spec): after Fill and a pasted npub, the verified card and
// the one primary button under it are both in view (the page brings the button back with the least scroll), in every
// language, with no sideways scroll.
test.describe('Nostr identity card in Bring in', () => {
  test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + NOSTR_PORT_OFFSET}` });
  for (const [lang, text] of Object.entries(LANGS)) {
    test(`verified card and primary button in view (${lang})`, async ({ page }, info) => {
      const label = `${info.project.name} ${lang} nostr`;
      await answerRelays(page, [vectors.bindingEvent]);
      await page.addInitScript((value) => localStorage.setItem('sampan.lang', value), lang);
      await page.goto('/');
      await page.locator('.judge__fill').click();
      await expect(page.getByRole('tab', { name: text['tabs.in'] })).toHaveAttribute('aria-selected', 'true');
      const opens: string[] = [];
      page.on('request', (r) => r.url().endsWith('/api/land/open') && opens.push(r.url()));
      await page.locator('.field__input--address').fill(vectors.nostr.npub);
      // Leaving the field commits the text, as a pasted npub would; the identity still waits for the button.
      await page.locator('.field__input--address').blur();
      await expect(page.locator('[data-nostr=verified]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.button--primary')).toHaveCount(1);
      await inView(page, '[data-nostr=verified]', label);
      await inView(page, '.button--primary', label);
      // A landing that opens by itself would ask on the render after the card; give it that window, then count.
      await page.waitForRequest((r) => r.url().endsWith('/api/land/open'), { timeout: 1_500 }).catch(() => undefined);
      expect(opens, `${label}: no landing opened by itself`).toEqual([]);
      await expect(page.locator('.land__address')).toHaveCount(0);
      const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(width[0], `${label}: no sideways scroll`).toBeLessThanOrEqual(width[1]!);
      await shot(page, `${info.project.name}-${lang}-nostr`);
    });
  }
});
