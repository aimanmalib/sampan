// The cost card (KJG2) in Send out and Bring in against the fake server with crossings on (fake THORNode answering
// from frozen mainnet captures): visible above the main button before any wallet is ready, the route's fees named
// with the amounts of the capture, the parts adding up to the total, no sideways scroll at 320 px, axe AA clean.
// Skipped against a live site.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import outCapture from '../tests/fixtures/thorchain/quote-out.json' with { type: 'json' };
import inCapture from '../tests/fixtures/thorchain/quote-in.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };
import { formatUsd, inCost, outCost } from '../core/cost.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + 2}` });

const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const BCH_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const card = (page: Page) => page.getByTestId('cost-card');
const row = (page: Page, key: string) => card(page).locator(`li[data-part="${key}"] .mono`);
const timing = { routeSeconds: 0, sourceBlockSeconds: 600, measured: [] as number[] };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function fitsAndPasses(page: Page): Promise<void> {
  await page.setViewportSize({ width: 320, height: 640 });
  await card(page).locator('summary').click();
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
  const axe = await new AxeBuilder({ page }).include('[data-testid="cost-card"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
}

/** The card sits above the main button and is shown while the button cannot be used yet (no wallet). */
async function aboveButton(page: Page, button: string): Promise<void> {
  const main = page.locator('.button--primary', { hasText: button });
  await expect(main).toBeVisible();
  const [c, b] = await Promise.all([card(page).boundingBox(), main.boundingBox()]);
  expect(c && b && c.y + c.height <= b.y).toBe(true);
}

test('Send out from BCH: the route fees of the capture, named, and a total that adds up', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await page.getByRole('radio', { name: 'From BCH' }).click();
  await page.locator('.out .field__input').first().fill('0.01');
  const reply = page.waitForResponse((r) => r.url().endsWith('/api/out/quote') && r.status() === 200);
  await page.getByPlaceholder('0x…').fill(DEST);
  const { quote } = (await (await reply).json()) as { quote: { sats: string; expectedOut: string; depositNetworkSats: string; expiry: number; fees: Record<string, string> } };
  await expect(card(page)).toBeVisible();
  await aboveButton(page, en['wallet.connect']);

  // 0.01 BCH is the amount the capture was taken for: the fees are the capture's own.
  expect(quote.fees.outbound).toBe(outCapture.fees.outbound);
  await expect(row(page, 'thorOutbound')).toHaveText(formatUsd(BigInt(outCapture.fees.outbound) / 100n));
  await expect(row(page, 'thorLiquidity')).toHaveText(formatUsd(BigInt(outCapture.fees.liquidity) / 100n));
  const expected = outCost({
    fromToken: false,
    amount: BigInt(quote.sats),
    tokenDecimals: 2,
    depositSats: BigInt(quote.sats),
    depositNetworkSats: BigInt(quote.depositNetworkSats),
    expectedOut: BigInt(quote.expectedOut),
    fees: { liquidity: BigInt(quote.fees.liquidity!), outbound: BigInt(quote.fees.outbound!), affiliate: BigInt(quote.fees.affiliate!), slippageBps: outCapture.fees.slippage_bps },
    expiry: quote.expiry,
    timing,
    warnBps: 500,
  });
  await expect(page.getByTestId('cost-total')).toHaveText(en['cost.total'].replace('{usd}', formatUsd(expected.totalUsd)));
  await expect(page.getByTestId('cost-clock')).toContainText(/holds for [0-9]+:[0-5][0-9]/);
  await fitsAndPasses(page);
  expect(errors).toEqual([]);
});

test('Bring in to BCH: the route fees in USD at the quote price, gas said to be extra on the fake server', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.getByRole('radio', { name: en['in.receiveAs'].replace('{asset}', 'BCH') }).click();
  await page.locator('.in .field__input').first().fill('5');
  await page.getByPlaceholder('bitcoincash:…').fill(BCH_ADDRESS);
  await expect(card(page)).toBeVisible({ timeout: 10_000 });
  await aboveButton(page, en['in.go']);

  // 5 USDC is the amount the capture was taken for.
  const fees = { liquidity: BigInt(inCapture.fees.liquidity), outbound: BigInt(inCapture.fees.outbound), affiliate: BigInt(inCapture.fees.affiliate), slippageBps: inCapture.fees.slippage_bps };
  const expected = inCost({ amount: 500_000_000n, expectedSats: BigInt(inCapture.expected_amount_out), fees, expiry: 0, timing, warnBps: 500 });
  await expect(row(page, 'thorOutbound')).toHaveText(formatUsd(expected.parts.find((p) => p.key === 'thorOutbound')!.usd));
  await expect(page.getByTestId('cost-total')).toHaveText(en['cost.total'].replace('{usd}', formatUsd(expected.totalUsd)));
  await expect(card(page)).toContainText(en['cost.gasExtra'].replace('{chain}', 'Base').replace('{native}', 'ETH'));
  await fitsAndPasses(page);
  expect(errors).toEqual([]);
});
