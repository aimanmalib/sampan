// WalletConnect for EVM wallets against the fake server (cross-chain on), where the page loads the e2e stand-in
// instead of the vendor provider: the option follows config.evm.walletConnect, the pairing dialog shows a wc: link
// as a QR code with "Open in wallet app", closes with Escape, and the approved account becomes the EVM wallet.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

const inPort = Number(process.env.E2E_PORT ?? 4173) + 2;
test.use({ baseURL: `http://127.0.0.1:${inPort}` });

const EVM_ADDRESS = '0x1a877169bB03400fA69EC4813889E78994D194Cb';

/** Serves /api/config with WalletConnect on (a made-up project id) or off, whatever config/sampan.json says. */
async function walletConnect(page: Page, on: boolean): Promise<string[]> {
  const loaded: string[] = [];
  page.on('request', (r) => /\/assets\/(wcFake|index\.es)-/.test(r.url()) && loaded.push(r.url()));
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { evm: { walletConnect: unknown } };
    body.evm.walletConnect = on ? { projectId: 'ab'.repeat(16), relayUrl: 'wss://relay.example.org' } : null;
    await route.fulfill({ response: res, json: body });
  });
  return loaded;
}

async function openBringIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
}

test('without a project id there is no WalletConnect option and its code is never loaded', async ({ page }) => {
  const loaded = await walletConnect(page, false);
  await openBringIn(page);
  await expect(page.locator('.evm--none')).toHaveText(en['evm.none']);
  await expect(page.getByRole('button', { name: en['evm.wc.button'] })).toHaveCount(0);
  expect(loaded).toEqual([]);
});

test('with a project id the pairing dialog shows a wc: link and the approved wallet connects', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 320, height: 640 });
  const loaded = await walletConnect(page, true);
  await openBringIn(page);
  await expect(page.locator('.evm--none')).toHaveText(en['evm.noneWc']);
  expect(loaded).toEqual([]);

  const button = page.getByRole('button', { name: en['evm.wc.button'] });
  await button.click();
  const dialog = page.getByRole('dialog', { name: en['evm.wc.title'] });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img', { name: en['evm.wc.qr'] })).toBeVisible();
  await expect(dialog.getByRole('link', { name: en['evm.wc.open'] })).toHaveAttribute('href', /^wc:[0-9a-f]{64}@2\?relay-protocol=irn&/);
  await expect(dialog.getByRole('button', { name: en['wallet.copyLink'] })).toBeVisible();
  await noHorizontalOverflow(page);
  // The code sits in the middle of the dialog at 320 px too.
  const box = (await dialog.boundingBox())!;
  const qr = (await dialog.getByRole('img', { name: en['evm.wc.qr'] }).boundingBox())!;
  expect(Math.abs(qr.x + qr.width / 2 - (box.x + box.width / 2))).toBeLessThan(2);
  expect(loaded.length).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeEnabled();

  await button.click();
  await expect(dialog.getByRole('link', { name: en['evm.wc.open'] })).toBeVisible();
  await page.evaluate((a) => window.dispatchEvent(new CustomEvent('sampan:wc-approve', { detail: a })), EVM_ADDRESS);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.evm--on')).toContainText(en['evm.connected'].replace('{name}', en['evm.wc.name']));
  await expect(page.locator('.evm--on')).toContainText(`${EVM_ADDRESS.slice(0, 6)}…${EVM_ADDRESS.slice(-4)}`);
  expect(errors).toEqual([]);
});
