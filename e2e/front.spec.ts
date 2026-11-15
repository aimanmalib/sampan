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
  // Only open flows have a tab, as the served config says; no tab says "Not open yet". The send out flow has no
  // panel yet, so it has no tab either.
  const { features } = (await (await page.request.get('/api/config')).json()) as { features: { swap: boolean; landing: boolean } };
  await expect(page.getByRole('tab')).toHaveCount(Number(features.swap) + Number(features.landing));
  await expect(page.getByRole('tab', { name: en['tabs.in'] })).toHaveCount(features.landing ? 1 : 0);
  await expect(page.getByText(en['tabs.out'])).toHaveCount(0);
  await expect(page.getByText(/Not open yet/i)).toHaveCount(0);
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('headline, picture, card and primary button fit on the first screen', async ({ page }) => {
  await page.goto('/');
  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  const boxes = {
    h1: await page.getByRole('heading', { level: 1 }).boundingBox(),
    scene: await page.locator('figure.scene').boundingBox(),
    tabs: await page.getByRole('tablist').boundingBox(),
    primary: await page.locator('.button--primary').boundingBox(),
  };
  for (const [name, box] of Object.entries(boxes)) {
    expect(box, name).toBeTruthy();
    expect(box!.y, name).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, name).toBeLessThanOrEqual(viewport!.height);
  }
});

test('touch targets are at least 44 px tall', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.banner__copy')).toBeVisible();
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a[href]')]
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44)
      .map((el) => el.className || el.tagName),
  );
  expect(small).toEqual([]);
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
