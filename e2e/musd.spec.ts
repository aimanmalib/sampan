// MUSD behind features.musd (MUSa, ADR 0075), against the network fake server, the only one with the flag on
// (playwright.config.ts networkPatch); the fake chain holds the captured pools under each offered token. Swap: the
// stablecoin choice shows only with a wallet connected and names PUSD and MUSD, MUSD is quoted, bought with the fake wallet and its balance read. Bring in:
// "As MUSD" quotes a landing address that turns the BCH into MUSD. Both fit 320 px with a clean console.
// Skipped against a live site.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { NETWORK_PORT_OFFSET } from '../playwright.config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + NETWORK_PORT_OFFSET}` });

const BCH_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function fits320(page: Page): Promise<void> {
  await page.setViewportSize({ width: 320, height: 640 });
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
}

const primary = (page: Page) => page.locator('.button--primary');

test('Swap: pick MUSD, see its quote, buy it with the fake wallet', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.swap'] }).click();
  const pick = page.getByRole('radiogroup', { name: en['swap.token'] });
  // No wallet yet: no stablecoin choice, so the first screen keeps its height (ADR 0096).
  await expect(page.locator('.swap__receive')).toContainText(/at least [0-9.]+ PUSD\./, { timeout: 15_000 });
  await expect(pick).toHaveCount(0);

  await primary(page).click();
  await expect(page.locator('.swap__wallet')).toContainText(/In your wallet: [0-9.]+ BCH and [0-9.]+ PUSD/, { timeout: 20_000 });
  await expect(pick.getByRole('radio')).toHaveText(['PUSD', 'MUSD']);
  await expect(pick.getByRole('radio', { name: 'PUSD', exact: true })).toHaveAttribute('aria-checked', 'true');
  await pick.getByRole('radio', { name: 'MUSD', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'BCH to MUSD' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.swap__receive')).toContainText(/at least [0-9.]+ MUSD\./, { timeout: 15_000 });
  await expect(page.locator('.swap__wallet')).toContainText(/In your wallet: [0-9.]+ BCH and [0-9.]+ MUSD/);
  await expect(primary(page)).toHaveText(en['swap.go']);
  await primary(page).click();
  await expect(page.locator('.swap__done')).toHaveText(en['swap.done'], { timeout: 20_000 });
  await fits320(page);
  expect(errors).toEqual([]);
});

test('Bring in: "As MUSD" quotes a landing address that turns into MUSD', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.getByRole('radio', { name: 'USDC and USDT on other chains' }).click();
  await page.getByPlaceholder('bitcoincash:…').fill(BCH_ADDRESS);
  await page.locator('.in .field__input').first().fill('5');
  const receive = page.getByRole('radiogroup', { name: en['in.receive'] });
  await expect(receive.getByRole('radio')).toHaveText(['As PUSD', 'As MUSD', 'As BCH']);
  await receive.getByRole('radio', { name: 'As MUSD' }).click();
  await expect(page.locator('.in .swap__receive')).toContainText('turns into MUSD.', { timeout: 15_000 });
  await fits320(page);
  expect(errors).toEqual([]);
});
