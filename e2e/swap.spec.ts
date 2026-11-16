// Swap on BCH against the fake server (SAMPAN_FAKE=1, swap switched on by SAMPAN_CONFIG_PATCH): connect the fake wallet, buy
// PUSD, sell some back, open the status page. Skipped against a live site, where no wallet can connect.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

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

test('buy PUSD with 0.001 BCH, then sell 1 PUSD back, then read the status page', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('tab', { name: en['tabs.swap'] })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox')).toHaveValue('0.001');
  await expect(page.locator('.swap__receive')).toContainText('at least');

  await expect(primary(page)).toHaveText(en['wallet.connect']);
  await primary(page).click();
  // The fake chain is shared by every browser in the run, so only the shape of the balance is fixed.
  const balance = /In your wallet: ([0-9.]+) BCH and ([0-9.]+) PUSD/;
  await expect(page.locator('.swap__wallet')).toContainText(balance, { timeout: 20_000 });
  const before = balance.exec((await page.locator('.swap__wallet').textContent()) ?? '')!;
  await expect(primary(page)).toHaveText(en['swap.go']);
  await expect(primary(page)).toBeEnabled();
  await noHorizontalOverflow(page);

  await primary(page).click();
  await expect(page.locator('.swap__done')).toHaveText(en['swap.done'], { timeout: 20_000 });
  await expect(page.getByRole('link', { name: en['swap.viewTx'] })).toHaveAttribute('href', /[0-9a-f]{64}$/);
  await expect(primary(page)).toHaveCount(1);

  await primary(page).click();
  await page.getByRole('radio', { name: 'PUSD to BCH' }).click();
  await page.getByRole('textbox').fill('1');
  await expect(page.locator('.swap__receive')).toContainText('BCH', { timeout: 10_000 });
  await expect(page.locator('.swap__wallet')).not.toContainText(`and ${before[2]} PUSD`, { timeout: 20_000 });
  await expect(primary(page)).toBeEnabled();
  await primary(page).click();
  await expect(page.locator('.swap__done')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('link', { name: en['swap.status'] }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['crossing.title']);
  await expect(page.locator('.crossing__status')).toHaveText(en['crossing.status.broadcast']);
  await expect(page.locator('.timeline__step--done')).toHaveCount(2);
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('an amount above the balance keeps the swap button off and says why', async ({ page }) => {
  await page.goto('/');
  await primary(page).click();
  await expect(page.locator('.swap__wallet')).toContainText('BCH', { timeout: 20_000 });
  await page.getByRole('textbox').fill('5');
  await expect(page.locator('.swap__error')).toHaveText(en['swap.err.short']);
  await expect(primary(page)).toBeDisabled();
});

test('an unknown status link says so', async ({ page }) => {
  await page.goto(`/c/${'0'.repeat(32)}`);
  await expect(page.getByText(en['crossing.missing'])).toBeVisible();
});

test('the Fees panel names the Sampan fee, none while business.feeBps is 0', async ({ page }) => {
  await page.goto('/');
  await page.locator('.swap__fees summary').click();
  await expect(page.locator('.swap__fees')).toContainText(en['swap.sampanFeeNone']);
});
