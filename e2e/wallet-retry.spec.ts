// A stored WizardConnect pairing whose wallet never answers: the page must not sit on a disabled "Waiting for your wallet"
// for ever. After connect.retryHintSeconds it offers to start again, and starting again gives back the Connect button.
import { expect, test } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

// A well-formed pairing for a wallet that does not exist (generator point x as its key), as the library stores it.
const STALE = JSON.stringify({
  privateKey: '11'.repeat(32),
  secret: 'aa'.repeat(8),
  walletPublicKey: '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  walletName: 'Gone wallet',
});

test('a stored pairing that never answers shows the retry hint, and Start again returns to Connect wallet', async ({ page, request }) => {
  const { connect } = (await (await request.get('/api/config')).json()) as { connect: { retryHintSeconds: number } };
  await page.clock.install();
  await page.goto('/');
  await page.evaluate((s) => localStorage.setItem('wizardconnect-session', s), STALE);
  await page.reload();

  const primary = page.locator('.button--primary');
  await expect(primary).toHaveText(en['wallet.connecting']);
  await expect(primary).toBeDisabled();
  await expect(page.getByText(en['wallet.retryHint'])).toHaveCount(0);

  await page.clock.fastForward(connect.retryHintSeconds * 1000);
  await expect(page.getByText(en['wallet.retryHint'])).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);

  await page.getByRole('button', { name: en['wallet.startAgain'] }).click();
  await expect(primary).toHaveText(en['wallet.connect']);
  await expect(primary).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('wizardconnect-session'))).toBeNull();
});
