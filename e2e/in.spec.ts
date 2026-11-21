// "Bring in" from Base against the third fake server (cross-chain on, fake THORNode) with a fake EIP-6963 wallet
// injected into the page: the wallet is listed with its own name, connects, approves the exact amount and
// deposits; the status page follows. Without a wallet the panel says how to get one. Skipped against a live site.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { EVM_ADDRESS, injectWallet } from './evm-wallet.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

const inPort = Number(process.env.E2E_PORT ?? 4173) + 2;
test.use({ baseURL: `http://127.0.0.1:${inPort}` });

const BCH_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';

async function noHorizontalOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
}

test('without an EVM wallet the panel says how to get one and offers no address to pay', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  // With WalletConnect configured the sentence points to it instead (e2e/walletconnect.spec.ts).
  const { evm } = (await (await page.request.get('/api/config')).json()) as { evm: { walletConnect: unknown } };
  await expect(page.locator('.evm--none')).toHaveText(en[evm.walletConnect ? 'evm.noneWc' : 'evm.none']);
  await expect(page.getByRole('button', { name: en['in.go'] })).toBeDisabled();
  await expect(page.locator('.in')).not.toContainText('0x');
  await noHorizontalOverflow(page);
});

test('bring 5 USDC in from Base as PUSD: exact approval, deposit, then the status pages', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await injectWallet(page);
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.getByRole('button', { name: 'Test EVM wallet' }).click();
  await expect(page.locator('.evm__who')).toContainText('Connected with Test EVM wallet');
  await page.locator('.in .field__input').first().fill('5');
  await page.getByPlaceholder('bitcoincash:…').fill(BCH_ADDRESS);
  await expect(page.locator('.swap__receive')).toContainText(/At least [0-9.]+ BCH lands at a landing address/, { timeout: 10_000 });
  await expect(page.locator('.card__note').last()).toContainText('approval for exactly 5 USDC');
  await page.getByRole('button', { name: en['in.go'] }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await noHorizontalOverflow(page);
  await dialog.getByRole('button', { name: en['disclose.ok'] }).click();
  await expect(page.locator('.swap__done')).toContainText('Sent. THORChain pays the BCH to your landing address', { timeout: 20_000 });
  const sent = await page.evaluate(() => (window as unknown as { __evmSent: Array<{ data: string }> }).__evmSent.map((s) => s.data.slice(0, 10)));
  // approve(router, 5 USDC), then depositWithExpiry(vault, asset, amount, memo, expiry).
  expect(sent).toEqual(['0x095ea7b3', '0x44bc937b']);

  await page.getByRole('link', { name: en['swap.status'] }).click();
  await expect(page.locator('.crossing__kind')).toHaveText(en['crossing.kind.in']);
  await expect(page.getByRole('link', { name: en['in.landingStatus'] })).toBeVisible();
  await noHorizontalOverflow(page);

  // Send out offers the connected address once a wallet is connected (a fresh page has none connected).
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await page.locator('.out__wallets > summary').click();
  await page.getByRole('button', { name: 'Test EVM wallet' }).click();
  await page.getByRole('button', { name: /Use my connected address/ }).click();
  await expect(page.getByPlaceholder('0x…')).toHaveValue(EVM_ADDRESS);
  expect(errors).toEqual([]);
});
