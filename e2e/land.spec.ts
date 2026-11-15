// Flow L against a fake server with the landing flow switched on: the judge strip fills the Bring in tab, the
// fake wallet opens a landing address and pays it, and the status page shows the BCH converted with the
// recovery card from the link. Skipped against a live site, where no wallet can connect.
import { encodeLockingBytecodeP2pkh, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');
// Second fake server from playwright.config.ts (port E2E_PORT + 1), started with the landing flow on.
const landingPort = Number(process.env.E2E_PORT ?? 4173) + 1;
test.use({ baseURL: `http://127.0.0.1:${landingPort}` });

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
}

const primary = (page: Page) => page.locator('.button--primary');

/**
 * With E2E_SHOTS_DIR set, saves a full-page screenshot. WebKit's screenshot injects a style element that the page's
 * CSP refuses, so console errors raised by the screenshot itself are dropped from `errors`.
 */
async function shot(page: Page, errors: string[], name: string, project: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  const before = errors.length;
  await page.screenshot({ path: `${dir}/sampan-land-${name}-${project}.png`, fullPage: true });
  await page.waitForTimeout(100);
  errors.splice(before);
}

test('judge path: fill, connect, get the landing address, pay from the wallet, see it converted', async ({ page }, info) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.judge__title')).toBeVisible();
  await shot(page, errors, 'front', info.project.name);
  // Phones show the short title in one row; wide screens show the full one.
  const phone = info.project.name.includes('iphone');
  await expect(page.locator('.judge__title')).toHaveAccessibleName(phone ? en['judge.short'] : en['judge.title']);
  await page.getByRole('button', { name: en['judge.fill'] }).click();
  await expect(page.getByRole('tab', { name: en['tabs.in'] })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(en['land.source'], { exact: true })).toBeVisible();
  await expect(primary(page)).toHaveCount(1);

  await expect(primary(page)).toHaveText(en['wallet.connect']);
  await primary(page).click();
  await expect(page.locator('.land__owner')).toContainText('Paid to your connected wallet', { timeout: 20_000 });
  await expect(primary(page)).toHaveText(en['land.open'], { timeout: 20_000 });
  await expect(primary(page)).toBeEnabled({ timeout: 20_000 });
  await primary(page).click();

  await expect(page.locator('.land__address')).toHaveText(/^bitcoincash:p[0-9a-z]{41}$/, { timeout: 20_000 });
  await expect(page.locator('svg.payqr')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue('0.001');
  await expect(primary(page)).toHaveText(en['land.pay']);
  await noHorizontalOverflow(page);
  await shot(page, errors, 'address', info.project.name);
  await primary(page).click();

  await page.waitForURL(/\/c\/[0-9a-f]{32}#card=[A-Za-z0-9_-]+$/, { timeout: 20_000 });
  await expect(page.locator('.crossing__kind')).toHaveText(en['crossing.kind.land']);
  await expect(page.locator('.crossing__status')).toHaveText(en['crossing.land.status.converted'].replace('{symbol}', 'PUSD'), { timeout: 25_000 });
  await expect(page.locator('.timeline__step--done')).toHaveCount(4);
  await expect(page.locator('.crossing__tx a')).toHaveCount(2);
  await page.locator('.recovery summary').click();
  await expect(page.locator('.recovery__json')).toContainText('"kind": "sampan-landing"');
  await expect(page.getByRole('button', { name: en['crossing.card.download'] })).toBeVisible();
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
  await shot(page, errors, 'status', info.project.name);
});

/** Bottom edge of an element in CSS pixels, failing when it is not laid out. */
async function bottom(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, selector).not.toBeNull();
  return box ? box.y + box.height : Infinity;
}

test('the picture, judge strip and card primary button are on the first screen, also after Fill', async ({ page }, info) => {
  const sizes = info.project.name.includes('desktop') ? [{ width: 1440, height: 900 }, { width: 1280, height: 720 }] : [null];
  for (const size of sizes) {
    if (size) await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('.judge__fill')).toBeVisible();
    await expect(primary(page)).toHaveCount(1);
    const height = page.viewportSize()?.height ?? 0;
    // PRD 4.10: the boat with its two labelled banks is part of the first screen, next to H1, card and strip.
    for (const selector of ['h1', '.scene', '.judge__fill', '.button--primary']) {
      expect(await bottom(page, selector), `${selector} at ${height}px high`).toBeLessThanOrEqual(height);
    }
    // The no-wallet hint lives in the landing panel only, not in the strip as well.
    await expect(page.locator('.judge').getByText(en['land.noWallet'])).toHaveCount(0);
    await noHorizontalOverflow(page);
    // After Fill the next step (the one primary button) is fully in view.
    await page.locator('.judge__fill').click();
    await expect(primary(page)).toHaveText(en['wallet.connect']);
    await expect(async () => {
      const box = await primary(page).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    }).toPass({ timeout: 2_000 });
  }
});

test('opened judge steps at 320 px take the full row and Fill sits below them', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.locator('.judge__title').click();
  await expect(page.locator('.judge__steps')).toBeVisible();
  const steps = await page.locator('.judge__steps').boundingBox();
  const fill = await page.locator('.judge__fill').boundingBox();
  expect(steps && fill).toBeTruthy();
  expect(fill!.y).toBeGreaterThanOrEqual(steps!.y + steps!.height);
  await noHorizontalOverflow(page);
});

test('a pasted token address gets a landing address and a QR to pay from any wallet, also at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const errors = collectErrors(page);
  const owner = lockingBytecodeToCashAddress({ bytecode: encodeLockingBytecodeP2pkh(new Uint8Array(20).fill(0x11)), prefix: 'bitcoincash', tokenSupport: true });
  if (typeof owner === 'string') throw new Error(owner);
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.getByRole('textbox').fill('not an address');
  await expect(page.getByText(en['land.err.owner'])).toBeVisible();
  await expect(primary(page)).toBeDisabled();
  await page.getByRole('textbox').fill(owner.address);
  await expect(primary(page)).toHaveText(en['land.open']);
  await primary(page).click();
  await expect(page.locator('.land__address')).toHaveText(/^bitcoincash:p/, { timeout: 20_000 });
  await expect(primary(page)).toHaveText(en['land.connectToPay']);
  await expect(page.getByText(en['land.noWallet'])).toHaveCount(1);
  await noHorizontalOverflow(page);
  const follow = await page.getByRole('link', { name: en['land.follow'] }).getAttribute('href');
  expect(follow).toMatch(/^\/c\/[0-9a-f]{32}#card=/);
  await page.goto(follow!);
  await expect(page.locator('.crossing__status')).toContainText('Waiting for BCH');
  await expect(page.locator('.timeline__step--done')).toHaveCount(1);
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
