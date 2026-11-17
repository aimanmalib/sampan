// The "Network" picker of Send out and Bring in (KMR2), against a fake server with Ethereum, BNB Smart Chain and Base
// live and the fake THORNode reporting Base halted (2026-11-17 capture): the halted chain is not offered, arrow keys
// move between networks, and the quote asked for after a change names the new chain and symbol. Skipped against a live site.
import { expect, test, type Page, type Request } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { NETWORK_PORT_OFFSET } from '../playwright.config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + NETWORK_PORT_OFFSET}` });

const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const BCH_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const OFFERED = ['USDC on Ethereum', 'USDC on BNB Smart Chain', 'USDT on BNB Smart Chain'];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** The body of the next quote request to `path` that matches `want`. */
const quoteAsked = (page: Page, path: string, want: Record<string, string>): Promise<Request> =>
  page.waitForRequest((r) => {
    if (!r.url().endsWith(path) || r.method() !== 'POST') return false;
    const body = r.postDataJSON() as Record<string, string>;
    return Object.entries(want).every(([k, v]) => body[k] === v);
  });

async function noHorizontalOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
}

async function offered(page: Page): Promise<string[]> {
  const group = page.getByRole('group', { name: en['cross.network'] });
  await expect(group.getByRole('radio')).toHaveCount(OFFERED.length);
  return group.getByRole('radio').evaluateAll((els) => els.map((el) => el.closest('label')?.textContent?.trim() ?? ''));
}

test('Send out offers only open chains, and the quote follows the network chosen', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  expect(await offered(page)).toEqual(OFFERED);
  await expect(page.getByRole('radio', { name: 'USDC on Base' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: OFFERED[0] })).toBeChecked();

  const first = quoteAsked(page, '/api/out/quote', { chain: 'ETH', symbol: 'USDC' });
  await page.getByPlaceholder('0x…').fill(DEST);
  await first;
  await expect(page.locator('.swap__receive')).toContainText(/You receive about [0-9.]+ USDC/, { timeout: 10_000 });

  // Arrow keys move between the radios of one group (native radios, no script of our own).
  const next = quoteAsked(page, '/api/out/quote', { chain: 'BSC', symbol: 'USDC' });
  await page.getByRole('radio', { name: OFFERED[0] }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: OFFERED[1] })).toBeChecked();
  await next;
  await expect(page.getByText('Your address on BNB Smart Chain')).toBeVisible();

  const usdt = quoteAsked(page, '/api/out/quote', { chain: 'BSC', symbol: 'USDT' });
  await page.getByText(OFFERED[2]).click();
  await usdt;
  await expect(page.locator('.swap__receive')).toContainText(/You receive about [0-9.]+ USDT/, { timeout: 10_000 });

  await page.setViewportSize({ width: 320, height: 640 });
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('Bring in names the other chains and offers the same open networks', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.getByRole('radio', { name: 'USDC and USDT on other chains' }).click();
  expect(await offered(page)).toEqual(OFFERED);
  await page.getByText(OFFERED[2]).click();
  await expect(page.getByText('Amount of USDT on BNB Smart Chain')).toBeVisible();

  const asked = quoteAsked(page, '/api/in/quote', { chain: 'BSC', symbol: 'USDT' });
  await page.getByPlaceholder('bitcoincash:…').fill(BCH_ADDRESS);
  await page.locator('.field__input').first().fill('5');
  await asked;
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
