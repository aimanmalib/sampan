// Header balance (features.headerBalance, K5P6) against the fake server: hidden before a wallet connects; after the fake
// wallet connects it shows BCH and PUSD from the wallet scan; a fake swap changes the numbers; a click opens the Swap tab;
// at 320 px the numbers stay whole (the pill takes its own line) without sideways scrolling.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');
// The landing-flow server: more than one tab, so the click can be seen switching to Swap.
const landingPort = Number(process.env.E2E_PORT ?? 4173) + 1;
test.use({ baseURL: `http://127.0.0.1:${landingPort}` });

const pill = (page: Page) => page.locator('.topbar .balance');
const primary = (page: Page) => page.locator('.button--primary');
const shape = /^([0-9.]+) BCH([0-9.]+) PUSD$/;

async function connect(page: Page): Promise<RegExpExecArray> {
  await page.goto('/');
  await expect(primary(page)).toHaveText(en['wallet.connect']);
  await expect(pill(page)).toHaveCount(0);
  await primary(page).click();
  // The fake chain is shared by every browser in the run, so only the shape of the balance is fixed.
  await expect(pill(page)).toHaveText(shape, { timeout: 20_000 });
  return shape.exec((await pill(page).textContent()) ?? '')!;
}

test('hidden before connecting, then BCH and PUSD from the wallet, changed by a swap', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  const before = await connect(page);
  // The Swap tab's own balance line reads the same scan.
  await expect(page.locator('.swap__wallet')).toContainText(`and ${before[2]} PUSD`);
  await expect(pill(page)).toHaveAttribute('aria-label', new RegExp(`${String(before[2]).replace('.', '\\.')} PUSD`));

  await expect(primary(page)).toHaveText(en['swap.go']);
  await primary(page).click();
  await expect(page.locator('.swap__done')).toHaveText(en['swap.done'], { timeout: 20_000 });
  await expect(pill(page)).not.toHaveText(`${before[1]} BCH${before[2]} PUSD`, { timeout: 20_000 });
  expect(errors).toEqual([]);
  // After the console check: a WebKit screenshot itself logs a style-src line (ADR 0055).
  await page.screenshot({ path: test.info().outputPath('balance.png') });
});

test('a click opens the Swap tab and moves focus to it', async ({ page }) => {
  await connect(page);
  await page.getByRole('tab').last().click();
  await expect(page.getByRole('tab', { name: en['tabs.swap'] })).toHaveAttribute('aria-selected', 'false');
  await pill(page).click();
  await expect(page.getByRole('tab', { name: en['tabs.swap'] })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: en['tabs.swap'] })).toBeFocused();
});

test('at 320 px every number stays whole, nothing overlaps and the page does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await connect(page);
  // After a scroll as well, where a header menu can come loose (mobile WebKit has no mouse wheel).
  await page.evaluate(() => window.scrollTo(0, 400));
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
  // No line of the pill is cut: each fits its own box.
  const cut = await page.locator('.balance__line').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(cut).toBe(0);
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const [mark, bal, lang] = [await box('.wordmark'), await box('.topbar .balance'), await box('.topbar__lang')];
  const apart = (a: typeof mark, b: typeof mark) =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  expect(apart(mark, bal) && apart(bal, lang) && apart(mark, lang)).toBe(true);
  for (const b of [mark, bal, lang]) expect(b.x + b.width).toBeLessThanOrEqual(320);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath('balance-320.png') });
});

test('on a wide screen the pill sits in the top row, before the language menu', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connect(page);
  const bal = (await page.locator('.topbar .balance').boundingBox())!;
  const lang = (await page.locator('.topbar__lang').boundingBox())!;
  expect(bal.x + bal.width).toBeLessThanOrEqual(lang.x);
  expect(Math.abs(bal.y + bal.height / 2 - (lang.y + lang.height / 2))).toBeLessThan(4);
});
