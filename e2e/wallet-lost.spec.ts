// A connected wallet that drops (K7P4): the page shows "Wallet disconnected" with Connect again, the header balance goes,
// and Connect again pairs anew without a reload. The drop is fired through the fake wallet's stand-in, which only the
// SAMPAN_FAKE server loads (web/src/wallet/lost.ts fakeLinkSource).
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');
// The landing-flow server shows the header balance, so its going away can be seen.
const landingPort = Number(process.env.E2E_PORT ?? 4173) + 1;
test.use({ baseURL: `http://127.0.0.1:${landingPort}` });

const pill = (page: Page) => page.locator('.topbar .balance');
const box = (page: Page) => page.locator('.wallet-lost');
const again = (page: Page) => page.getByRole('button', { name: en['wallet.lost.again'] });
const link = (page: Page, event: string) =>
  page.evaluate((detail) => window.dispatchEvent(new CustomEvent('sampan:wallet-link', { detail })), event);

async function connect(page: Page): Promise<void> {
  await page.getByRole('button', { name: en['wallet.connect'] }).first().click();
  await expect(pill(page)).toBeVisible({ timeout: 20_000 });
}

test('a wallet that disconnects shows Wallet disconnected, and Connect again pairs without a reload', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await page.evaluate(() => ((window as unknown as { __loaded: boolean }).__loaded = true));
  await connect(page);
  await expect(box(page)).toHaveCount(0);

  await link(page, 'disconnect');
  await expect(box(page)).toBeVisible();
  await expect(box(page)).toContainText(en['wallet.lost.title']);
  await expect(box(page)).toContainText(en['wallet.lost.body']);
  await expect(again(page)).toBeVisible();
  await expect(pill(page)).toHaveCount(0);
  // One action: the card's only visible primary button is Connect again, and the notice itself has no button.
  const primaries = page.locator('section.card .button--primary:visible');
  await expect(primaries).toHaveCount(1);
  await expect(primaries).toHaveText(en['wallet.lost.again']);
  await expect(box(page).getByRole('button')).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 700 });
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);

  await again(page).click();
  await expect(pill(page)).toBeVisible({ timeout: 20_000 });
  await expect(box(page)).toHaveCount(0);
  // Same document: Connect again did not reload the page.
  expect(await page.evaluate(() => (window as unknown as { __loaded?: boolean }).__loaded)).toBe(true);
  expect(errors).toEqual([]);
});

test('reconnecting is lost only after connect.lostAfterSeconds, and walletready before that keeps the wallet', async ({ page, request }) => {
  test.setTimeout(60_000);
  const { connect: c } = (await (await request.get('/api/config')).json()) as { connect: { lostAfterSeconds: number } };
  expect(c.lostAfterSeconds).toBeGreaterThan(0);
  await page.clock.install();
  await page.goto('/');
  await connect(page);

  await link(page, 'reconnecting');
  await page.clock.fastForward(c.lostAfterSeconds * 500);
  await link(page, 'walletready');
  await page.clock.fastForward(c.lostAfterSeconds * 2000);
  await expect(box(page)).toHaveCount(0);
  await expect(pill(page)).toBeVisible();

  await link(page, 'reconnecting');
  await page.clock.fastForward(c.lostAfterSeconds * 1000 - 1000);
  await expect(box(page)).toHaveCount(0);
  await page.clock.fastForward(1000);
  await expect(box(page)).toBeVisible();
  await expect(pill(page)).toHaveCount(0);
});
