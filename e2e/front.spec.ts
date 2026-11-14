import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };

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
  expect(res?.headers()['x-robots-tag']).toContain('noindex');
  await expect(page).toHaveTitle(/BCH BLAZE 2026/);
  await expect(page.locator('.banner__event')).toHaveText('BCH BLAZE 2026');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['hero.title']);
  await expect(page.locator('.button--primary')).toHaveCount(1);
  await expect(page.getByText(en['scene.left'])).toBeVisible();
  await expect(page.getByText(en['scene.right'], { exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(3);
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('headline and action card fit on the first screen', async ({ page }) => {
  await page.goto('/');
  const viewport = page.viewportSize();
  const tabs = await page.getByRole('tablist').boundingBox();
  const h1 = await page.getByRole('heading', { level: 1 }).boundingBox();
  expect(viewport && h1 && tabs).toBeTruthy();
  expect(h1!.y).toBeLessThan(viewport!.height);
  expect(tabs!.y + tabs!.height).toBeLessThanOrEqual(viewport!.height);
});

test('language switch shows Malay text and keeps the event name', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: en['lang.switchLabel'] }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ms['hero.title']);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ms');
  await expect(page.locator('.banner__event')).toHaveText('BCH BLAZE 2026');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ms['hero.title']);
});

test('no horizontal overflow at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await noHorizontalOverflow(page);
});
