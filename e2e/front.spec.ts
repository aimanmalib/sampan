import { expect, test, type Page } from '@playwright/test';
import { openFlows, openTabs, type FlowFlags } from '../core/flows.js';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import repoConfig from '../config/sampan.json' with { type: 'json' };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(client);
}

test('front page: banner, one headline, one primary button, both banks, no console errors', async ({ page }) => {
  const errors = collectErrors(page);
  const res = await page.goto('/');
  // noindex until the soft launch (config site.noindex), then no robots header at all.
  if (repoConfig.site.noindex) expect(res?.headers()['x-robots-tag']).toContain('noindex');
  else expect(res?.headers()['x-robots-tag']).toBeUndefined();
  await expect(page).toHaveTitle(/BCH BLAZE 2026/);
  await expect(page.locator('.banner__event')).toHaveText('BCH BLAZE 2026');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['hero.title']);
  await expect(page.locator('.button--primary')).toHaveCount(1);
  await expect(page.getByText(en['scene.left'])).toBeVisible();
  await expect(page.getByText(en['scene.right'], { exact: true })).toBeVisible();
  // Only open flows have a tab, as the served config says (core/flows openTabs); no tab says "Not open yet".
  const served = (await (await page.request.get('/api/config')).json()) as FlowFlags;
  const tabs = openTabs(openFlows(served));
  await expect(page.getByRole('tab')).toHaveCount(tabs.length);
  await expect(page.getByRole('tab', { name: en['tabs.in'] })).toHaveCount(tabs.includes('in') ? 1 : 0);
  await expect(page.getByRole('tab', { name: en['tabs.out'] })).toHaveCount(tabs.includes('out') ? 1 : 0);
  await expect(page.getByText(/Not open yet/i)).toHaveCount(0);
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('headline, picture, card and primary button fit on the first screen', async ({ page }) => {
  await page.goto('/');
  // #root holds a static headline until the app mounts and replaces it, so a one-off measurement can catch the
  // replaced node; toBeInViewport retries until the app's own element is fully on the first screen.
  const parts = {
    h1: page.getByRole('heading', { level: 1 }),
    scene: page.locator('figure.scene'),
    tabs: page.getByRole('tablist'),
    primary: page.locator('.button--primary'),
  };
  for (const [name, part] of Object.entries(parts)) {
    await expect(part, name).toBeInViewport({ ratio: 1 });
  }
});

// Links inside a sentence (the banner note's deck and source links, ADR 0070) follow the text, as WCAG 2.5.8 allows
// and e2e/a11y.spec.ts already counts them; every other button and link is checked.
test('touch targets are at least 44 px tall', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.banner__copy')).toBeVisible();
  // Presentation and source code, plus Demo while features.demo is on.
  await expect(page.locator('.banner__lead a')).toHaveCount(repoConfig.features.demo ? 3 : 2);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a[href]:not(p a)')]
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44)
      .map((el) => el.className || el.tagName),
  );
  expect(small).toEqual([]);
});

test('language switch shows Malay text and keeps the event name', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: en['lang.label'] }).selectOption('ms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ms['hero.title']);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ms');
  await expect(page.locator('.banner__event')).toHaveText('BCH BLAZE 2026');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ms['hero.title']);
});

test('language menu lists the languages config offers, in order, and sets html lang', async ({ page, request }) => {
  const config = (await (await request.get('/api/config')).json()) as { i18n: { default: string; languages: { code: string; name: string }[] } };
  // A stored code the config does not offer falls back to the config default.
  await page.addInitScript(() => localStorage.setItem('sampan.lang', 'xx'));
  await page.goto('/');
  const menu = page.getByRole('combobox', { name: en['lang.label'] });
  await expect(menu.locator('option')).toHaveText(config.i18n.languages.map((l) => l.name));
  await expect(menu).toHaveValue(config.i18n.default);
  await expect(page.locator('html')).toHaveAttribute('lang', config.i18n.default);
  const box = await menu.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
});

test('no horizontal overflow at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await noHorizontalOverflow(page);
});
