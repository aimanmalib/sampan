// judge.openOnPhone (KMN4, docs/decisions/0069): the judge steps start unfolded without a tap. On an iPhone 13 the
// strip above the card keeps its title and Fill, the unfolded box sits right under the card, and the card's primary
// button stays on the first screen; the title jumps to the box. On a 1280x720 desktop the steps unfold inside the
// box with Fill beside the title, still on the first screen. Switched off, the steps stay folded as before.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { judgeOpenOnPhone } from './judge-config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server with the landing flow');
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + 1}` });

async function inView(page: Page, selector: string): Promise<void> {
  const height = page.viewportSize()!.height;
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${selector} is laid out`).not.toBeNull();
  expect(box!.y, `${selector} top`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${selector} bottom`).toBeLessThanOrEqual(height);
}

async function noSideways(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client!);
}

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.judge__fill')).toHaveText(en['judge.fill']);
  await expect(page.locator('.swap__receive')).toContainText(/\d/, { timeout: 10_000 });
}

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('on: the box under the card is open without a tap, the primary button stays on the first screen', async ({ page }) => {
    await judgeOpenOnPhone(page, true);
    await ready(page);
    const box = page.locator('details#judge-box');
    await expect(box).toHaveAttribute('open', '');
    await expect(box.locator('.judge__steps')).toBeVisible();
    await expect(box.locator('summary')).toHaveText(en['judge.box']);
    const card = await page.locator('section.card').boundingBox();
    const under = await box.boundingBox();
    expect(under!.y).toBeGreaterThanOrEqual(card!.y + card!.height);
    for (const selector of ['.judge__title', '.judge__fill', '.button--primary']) await inView(page, selector);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator('.judge__title')).toHaveText(en['judge.title']);
    await noSideways(page);

    // One tap on the strip's title brings the proof link into view.
    await page.locator('.judge__title').click();
    const proof = box.getByRole('link', { name: en['judge.proof'] });
    await expect(proof).toHaveAttribute('href', '/how#proof');
    await expect(proof).toBeInViewport();
  });

  test('on at 320 px: no sideways scroll and the primary button in view', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await judgeOpenOnPhone(page, true);
    await ready(page);
    await expect(page.locator('details#judge-box')).toHaveAttribute('open', '');
    await inView(page, '.button--primary');
    await noSideways(page);
  });

  test('off: no box under the card, the steps stay folded in the strip', async ({ page }) => {
    await judgeOpenOnPhone(page, false);
    await ready(page);
    await expect(page.locator('#judge-box')).toHaveCount(0);
    await expect(page.locator('details.judge__more')).not.toHaveAttribute('open', /.*/);
    await expect(page.locator('.judge__steps')).toBeHidden();
  });
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'two-column layout');

  test('on at 1280x720: steps open without a tap, title, Fill and the primary button on the first screen', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await judgeOpenOnPhone(page, true);
    await ready(page);
    await expect(page.locator('details.judge__more')).toHaveAttribute('open', '');
    await expect(page.locator('.judge__steps')).toBeVisible();
    await expect(page.locator('#judge-box')).toHaveCount(0);
    for (const selector of ['.judge__title', '.judge__fill', '.button--primary']) await inView(page, selector);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('off at 1280x720: steps folded, as before', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await judgeOpenOnPhone(page, false);
    await ready(page);
    await expect(page.locator('details.judge__more')).not.toHaveAttribute('open', /.*/);
  });
});
