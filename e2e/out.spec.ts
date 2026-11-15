// "Send out" against the third fake server (cross-chain on, fake THORNode from frozen mainnet captures): connect
// the fake wallet, send 2 PUSD out in two signatures, open the status page. Skipped against a live site.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

const outPort = Number(process.env.E2E_PORT ?? 4173) + 2;
test.use({ baseURL: `http://127.0.0.1:${outPort}` });

const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const primary = (page: Page) => page.locator('.button--primary');

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

test('send 2 PUSD out in two signatures, then follow it on the status page', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await expect(page.getByRole('radio', { name: 'From PUSD' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.field__input').first()).toHaveValue('2.00');
  await expect(page.locator('.swap__receive')).toContainText('Enter an amount and the address');
  await page.getByPlaceholder('0x…').fill(DEST);
  await expect(page.locator('.swap__receive')).toContainText(/You receive about [0-9.]+ USDC, at least [0-9.]+ USDC/, { timeout: 10_000 });
  await expect(page.locator('.card__note')).toContainText('step 1 swaps your PUSD to BCH');

  await primary(page).click();
  await expect(primary(page)).toHaveText(en['out.go'], { timeout: 20_000 });
  await expect(primary(page)).toBeEnabled();
  await noHorizontalOverflow(page);
  await primary(page).click();
  await expect(page.locator('.swap__done')).toContainText('Sent. THORChain pays the USDC', { timeout: 30_000 });

  await page.getByRole('link', { name: en['swap.status'] }).click();
  await expect(page.locator('.crossing__kind')).toHaveText(en['crossing.kind.out']);
  // The fake THORNode answers "finished" for any deposit txid not ending in 00, "not seen yet" for the rest.
  await expect(page.locator('.crossing__status')).toHaveText(/Done\. The USDC was sent to your address\.|Waiting for THORChain to see the deposit/);
  await expect(page.locator('.timeline__step--done').first()).toBeVisible();
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('a wrong address says so and no quote is asked for; nothing overflows at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await page.getByPlaceholder('0x…').fill('0x1234');
  await expect(page.locator('.field__hint')).toHaveText('This is not an address on Base.');
  await expect(page.locator('.swap__receive')).toContainText('Enter an amount and the address');
  await page.getByRole('radio', { name: 'From BCH' }).click();
  await page.locator('.field__input').first().fill('0.001');
  await page.getByPlaceholder('0x…').fill(DEST);
  await expect(page.locator('.swap__receive')).toHaveText('At least USD 1.5 per crossing.', { timeout: 10_000 });
  await noHorizontalOverflow(page);
});
