// The review before signing (features.reviewModal, K5P8) against the fake servers, the flag and a 2 s price refresh
// switched on in the page's /api/config: one dialog in Swap, Send out and Bring in; Escape signs nothing; a press on
// unchanged numbers signs once; a price that moves while the dialog is open says "Price updated" and needs a second
// press; before a first crossing the disclosure lines sit inside the same dialog. Skipped against a live site.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { injectWallet } from './evm-wallet.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

const port = Number(process.env.E2E_PORT ?? 4173);
/** The swap-only server and the cross-chain server (fake THORNode, Base live). */
const swapUrl = `http://127.0.0.1:${port}/`;
const crossUrl = `http://127.0.0.1:${port + 2}/`;
const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const BCH_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const REFRESH_MS = 2000;

const primary = (page: Page) => page.locator('.swap .button--primary').first();
const dialog = (page: Page) => page.getByRole('dialog');
const go = (page: Page) => dialog(page).locator('.review__go');

/** Turns the review on and lets prices refresh by themselves, in this page only (the servers keep their config). */
async function reviewOn(page: Page): Promise<void> {
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { features: Record<string, boolean>; quote: Record<string, number> };
    body.features.reviewModal = true;
    body.quote = { ...body.quote, autoRefreshMs: REFRESH_MS };
    await route.fulfill({ response: res, json: body });
  });
}

/** Counts the requests whose path ends with one of `paths` (a build request = the wallet is about to be asked to sign). */
function counter(page: Page, ...paths: string[]): () => number {
  let n = 0;
  page.on('request', (r) => {
    if (paths.some((p) => new URL(r.url()).pathname === p)) n += 1;
  });
  return () => n;
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function axeClean(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('.connect__box.review').analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const sizes = await page.evaluate(() => {
    const box = document.querySelector('.connect__box.review');
    return [document.documentElement.scrollWidth, document.documentElement.clientWidth, box?.scrollWidth ?? 0, box?.clientWidth ?? 0];
  });
  expect(sizes[0]).toBeLessThanOrEqual(sizes[1]!);
  expect(sizes[2]).toBeLessThanOrEqual(sizes[3]!);
}

async function connectSwap(page: Page): Promise<void> {
  await page.goto(swapUrl);
  await expect(page.getByRole('textbox')).toHaveValue('0.001');
  await primary(page).click();
  await expect(page.locator('.swap__wallet')).toContainText('PUSD', { timeout: 20_000 });
  await expect(primary(page)).toHaveText(en['swap.go']);
  await expect(primary(page)).toBeEnabled();
}

test('Swap: the review lists the numbers, keeps focus, Escape signs nothing, Confirm signs once', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await reviewOn(page);
  const builds = counter(page, '/api/swap/build');
  const sends = counter(page, '/api/broadcast');
  await connectSwap(page);

  await primary(page).click();
  await expect(dialog(page)).toHaveCount(1);
  await expect(dialog(page)).toHaveAccessibleName(en['review.title']);
  const rows = dialog(page).locator('.review__row');
  await expect(rows).toHaveCount(5);
  expect(await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.row))).toEqual(['pay', 'receive', 'cost', 'route', 'to']);
  await expect(rows.first()).toContainText('0.001 BCH');
  await expect(dialog(page).locator('[data-row="receive"] dd')).toHaveText(/^about [0-9.]+ PUSD, at least [0-9.]+ PUSD$/);
  await expect(go(page)).toHaveText(en['review.confirm']);
  await axeClean(page);
  await noHorizontalOverflow(page);
  // Focus starts on the close button and Tab, forwards and back, never leaves the dialog.
  await expect(dialog(page).getByRole('button', { name: en['wallet.close'] })).toBeFocused();
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) === true), key).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(builds()).toBe(0);

  await primary(page).click();
  await go(page).click();
  await expect(page.locator('.swap__done')).toHaveText(en['swap.done'], { timeout: 20_000 });
  expect(builds()).toBe(1);
  expect(sends()).toBe(1);
  expect(errors).toEqual([]);
});

test('Swap: a price that moves while the review is open says so and needs a second press', async ({ page }) => {
  test.setTimeout(60_000);
  await reviewOn(page);
  let moved = false;
  await page.route('**/api/swap/quote', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { quote: { demand: string; minReceive: string } };
    if (moved) {
      body.quote.demand = String(BigInt(body.quote.demand) - 1n);
      body.quote.minReceive = String(BigInt(body.quote.minReceive) - 1n);
    }
    await route.fulfill({ response: res, json: body });
  });
  const builds = counter(page, '/api/swap/build');
  await connectSwap(page);

  await primary(page).click();
  const receive = dialog(page).locator('[data-row="receive"] dd');
  const before = await receive.textContent();
  await expect(page.getByTestId('review-updated')).toHaveCount(0);
  moved = true;
  // The refresh goes on under this dialog only; the next answer carries the lower numbers.
  await expect(page.getByTestId('review-updated')).toHaveText(en['review.updated'], { timeout: REFRESH_MS * 4 });
  await expect(receive).not.toHaveText(before ?? '');
  await expect(go(page)).toHaveText(en['review.accept']);

  await go(page).click();
  await expect(page.getByTestId('review-updated')).toHaveCount(0);
  await expect(go(page)).toHaveText(en['review.confirm']);
  await expect(dialog(page)).toHaveCount(1);
  expect(builds()).toBe(0);

  await go(page).click();
  await expect(page.locator('.swap__done')).toHaveText(en['swap.done'], { timeout: 20_000 });
  expect(builds()).toBe(1);
  // A refresh can still be in flight; it must not land in the next test.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('Send out: one dialog holds the review and the first-crossing lines; Escape signs nothing, Confirm sends once', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await reviewOn(page);
  const builds = counter(page, '/api/out/build');
  await page.goto(crossUrl);
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await page.getByPlaceholder('0x…').fill(DEST);
  await expect(page.locator('.swap__receive')).toContainText(/You receive about [0-9.]+ USDC/, { timeout: 10_000 });
  await primary(page).click();
  await expect(primary(page)).toHaveText(en['out.go'], { timeout: 20_000 });
  await expect(primary(page)).toBeEnabled();

  await primary(page).click();
  await expect(dialog(page)).toHaveCount(1);
  expect(await dialog(page).locator('.review__row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.row))).toEqual(['pay', 'receive', 'keep', 'cost', 'route', 'time', 'to']);
  await expect(dialog(page).locator('[data-row="to"] dd')).toHaveText('0x1a87…94Cb');
  await expect(dialog(page).locator('[data-row="cost"] dd')).toHaveText(/^USD [0-9.]+$/);
  await expect(dialog(page)).toContainText(en['disclose.final']);
  await axeClean(page);
  await noHorizontalOverflow(page);

  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(builds()).toBe(0);

  await primary(page).click();
  await go(page).click();
  await expect(page.locator('.swap__done')).toContainText('Sent. THORChain pays the USDC', { timeout: 30_000 });
  expect(builds()).toBe(1);
  // Confirming the review counts as "I understand": no separate disclosure next time.
  expect(await page.evaluate(() => localStorage.getItem('sampan.crossDisclosure'))).toBe('1');
  expect(errors).toEqual([]);
});

test('Bring in: Escape asks the EVM wallet for nothing, Confirm asks for the approval and the deposit', async ({ page }) => {
  test.setTimeout(60_000);
  await injectWallet(page);
  await reviewOn(page);
  await page.goto(crossUrl);
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.getByRole('button', { name: 'Test EVM wallet' }).click();
  await page.locator('.in .field__input').first().fill('5');
  await page.getByPlaceholder('bitcoincash:…').fill(BCH_ADDRESS);
  await expect(page.locator('.swap__receive')).toContainText(/At least [0-9.]+ BCH lands at a landing address/, { timeout: 10_000 });
  const sent = () => page.evaluate(() => (window as unknown as { __evmSent: Array<{ data: string }> }).__evmSent.map((s) => s.data.slice(0, 10)));

  await page.getByRole('button', { name: en['in.go'] }).click();
  await expect(dialog(page)).toHaveCount(1);
  await expect(dialog(page).locator('[data-row="pay"] dd')).toHaveText('5 USDC');
  await expect(dialog(page).locator('[data-row="receive"] dd')).toContainText('PUSD');
  await expect(dialog(page)).toContainText(en['disclose.final']);
  await axeClean(page);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(await sent()).toEqual([]);

  await page.getByRole('button', { name: en['in.go'] }).click();
  await go(page).click();
  await expect(page.locator('.swap__done')).toContainText('Sent. THORChain pays the BCH to your landing address', { timeout: 20_000 });
  expect(await sent()).toEqual(['0x095ea7b3', '0x44bc937b']);
});
