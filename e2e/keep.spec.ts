// "You keep" per network before signing (K4B4, ADR 0074), against the network fake server, the only one with
// features.keepCompare on (playwright.config.ts networkPatch): USDC is live on Ethereum, BNB Smart Chain and Base,
// and the fake THORNode reports Base halted (2026-11-17 capture). The quotes for Ethereum are cut by a tenth on the
// way to the page, so BNB Smart Chain keeps the most. The list shows all three networks with Base greyed and not
// pressable, marks BNB Smart Chain, picks a network when a row is pressed, fits 320 px and passes axe (WCAG 2.1 AA).
// Skipped against a live site.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { NETWORK_PORT_OFFSET } from '../playwright.config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + NETWORK_PORT_OFFSET}` });

const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const BCH_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const PAUSED_TEXT = en['cross.network.paused'].replace('{route}', en['route.thorchain']);
const ETH = 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48';
const BSC = 'BSC.USDC-0X8AC76A51CC950D9822D68B83FE1AD97B32CD580D';
const BASE = 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913';
const KEEP = /^You keep [0-9.]+ (USDC|PUSD) \([0-9.]+%\)$/;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Cuts the amount of every Ethereum quote by a tenth (out: expectedOut; in: expectedSats). */
async function cutEthereum(page: Page, path: string, field: 'expectedOut' | 'expectedSats'): Promise<void> {
  await page.route(`**${path}`, async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { quote?: Record<string, string> };
    if ((route.request().postDataJSON() as { chain?: string }).chain === 'ETH' && body.quote?.[field]) {
      body.quote[field] = String((BigInt(body.quote[field]) * 9n) / 10n);
    }
    await route.fulfill({ response: res, json: body });
  });
}

const row = (page: Page, asset: string) => page.getByTestId('keep').locator(`.keep__row[data-asset="${asset}"]`);

async function expectCompared(page: Page): Promise<void> {
  const keep = page.getByTestId('keep');
  await expect(keep).toBeVisible({ timeout: 15_000 });
  await expect(keep.locator('.keep__row')).toHaveCount(3);
  await expect(row(page, BASE)).toHaveAttribute('data-status', 'paused');
  await expect(row(page, BASE)).toBeDisabled();
  await expect(row(page, BASE)).toContainText(PAUSED_TEXT);
  await expect(row(page, BASE).locator('.keep__amount')).toHaveCount(0);
  for (const a of [ETH, BSC]) await expect(row(page, a).locator('.keep__amount')).toHaveText(KEEP, { timeout: 15_000 });
  await expect(row(page, BSC)).toHaveAttribute('data-best', 'true');
  await expect(keep.locator('[data-best]')).toHaveCount(1);
  await expect(row(page, BSC)).toContainText(en['keep.best']);
}

async function fitsAndPasses(page: Page): Promise<void> {
  await page.setViewportSize({ width: 320, height: 640 });
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="keep"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
}

test('Send out: three networks, Base greyed, BNB Smart Chain keeps the most and is picked when pressed', async ({ page }) => {
  const errors = collectErrors(page);
  await cutEthereum(page, '/api/out/quote', 'expectedOut');
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await page.getByPlaceholder('0x…').fill(DEST);
  await expectCompared(page);
  await expect(row(page, ETH)).toHaveAttribute('aria-pressed', 'true');

  await row(page, BSC).click();
  await expect(page.getByRole('group', { name: en['cross.network'] }).getByRole('radio', { name: 'USDC on BNB Smart Chain' })).toBeChecked();
  await expect(row(page, BSC)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Your address on BNB Smart Chain')).toBeVisible();
  await fitsAndPasses(page);
  expect(errors).toEqual([]);
});

test('Bring in: the same three networks are compared before the wallet signs', async ({ page }) => {
  const errors = collectErrors(page);
  await cutEthereum(page, '/api/in/quote', 'expectedSats');
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.getByRole('radio', { name: 'USDC and USDT on other chains' }).click();
  await page.getByPlaceholder('bitcoincash:…').fill(BCH_ADDRESS);
  await page.locator('.in .field__input').first().fill('5');
  await expectCompared(page);
  await expect(page.getByTestId('keep')).toContainText(en['keep.gasExtra']);
  await row(page, BSC).click();
  await expect(page.getByText('Amount of USDC on BNB Smart Chain')).toBeVisible();
  await fitsAndPasses(page);
  expect(errors).toEqual([]);
});
