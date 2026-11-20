// How many times a person signs for each flow, counted on the fake servers with the fake wallets (K6P5): every BCH
// transaction the page sends goes through POST /api/broadcast once, and every EVM transaction through the injected
// wallet's eth_sendTransaction once. A landing address is made without any wallet: Sampan asks for no signature and
// the person pays it once from any BCH wallet. With ROUTE_SIGNATURES_OUT set, the counts of the Chromium project are
// written there as JSON (tools/measure/route-facts.ts reads them). Skipped against a live site.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { parseAddress, tokenAddressOf } from '../core/address.js';
import { ONECLICK_PORT_OFFSET } from '../playwright.config.js';
import type { SignatureCounts } from '../core/route-facts.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');
test.describe.configure({ mode: 'serial' });

const base = Number(process.env.E2E_PORT ?? 4173);
const landingUrl = `http://127.0.0.1:${base + 1}`;
const crossUrl = `http://127.0.0.1:${base + 2}`;
const ocUrl = `http://127.0.0.1:${base + ONECLICK_PORT_OFFSET}`;
const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const BCH_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const TOKEN_ADDRESS = tokenAddressOf((parseAddress(BCH_ADDRESS, 'bitcoincash') as { lockingHex: string }).lockingHex, 'bitcoincash');

const counts: Partial<SignatureCounts> = {};
const primary = (page: Page) => page.locator('.button--primary');
const row = (page: Page, name: string) => page.locator(`.routes__row[data-route="${name}"]`);

/** Counts the BCH transactions the page hands to the server to broadcast. */
function bchSigned(page: Page): { n: number } {
  const seen = { n: 0 };
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/broadcast') seen.n += 1;
  });
  return seen;
}

/** An EIP-6963 wallet that answers the calls the page makes and keeps every transaction it is asked to send. */
async function injectEvmWallet(page: Page): Promise<void> {
  await page.addInitScript((account) => {
    const sent: string[] = [];
    let chain = '0x1';
    let allowance = 0n;
    const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`;
    const provider = {
      async request({ method, params }: { method: string; params?: Array<Record<string, string>> }) {
        const p = params ?? [];
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
        if (method === 'eth_chainId') return chain;
        if (method === 'wallet_switchEthereumChain') return void (chain = p[0]!.chainId!);
        if (method === 'wallet_revokePermissions') return null;
        if (method === 'eth_call') {
          const data = p[0]!.data!;
          if (data.startsWith('0x313ce567')) return word(6n);
          if (data.startsWith('0x70a08231')) return word(100_000_000n);
          if (data.startsWith('0xdd62ed3e')) return word(allowance);
          return '0x';
        }
        if (method === 'eth_sendTransaction') {
          const data = p[0]!.data!;
          sent.push(data.slice(0, 10));
          if (data.startsWith('0x095ea7b3')) allowance = BigInt(`0x${data.slice(74)}`);
          return `0x${String(sent.length).padStart(64, '1')}`;
        }
        if (method === 'eth_getTransactionReceipt') return { status: '0x1' };
        throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
      },
      on() {},
      removeListener() {},
    };
    const icon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#555"/></svg>')}`;
    const announce = () =>
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: 'test-evm', name: 'Test EVM wallet', icon, rdns: 'test.evm' }, provider }) }));
    window.addEventListener('eip6963:requestProvider', announce);
    (window as unknown as { __evmSent: string[] }).__evmSent = sent;
  }, DEST);
}

const evmSent = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __evmSent: string[] }).__evmSent.length);

/** The first crossing in a browser asks once before the wallet signs. */
async function acceptDisclosure(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: en['disclose.ok'] }).click();
}

test('Swap on BCH: one signature', async ({ page }) => {
  test.setTimeout(60_000);
  const bch = bchSigned(page);
  await page.goto(landingUrl);
  await page.getByRole('tab', { name: en['tabs.swap'] }).click();
  await primary(page).click();
  await expect(primary(page)).toHaveText(en['swap.go'], { timeout: 20_000 });
  await expect(primary(page)).toBeEnabled();
  await primary(page).click();
  await expect(page.locator('.swap__done')).toHaveText(en['swap.done'], { timeout: 20_000 });
  counts.swap = bch.n;
  expect(bch.n).toBe(1);
});

test('landing address: made without a wallet, Sampan asks for no signature', async ({ page }) => {
  const bch = bchSigned(page);
  await page.goto(landingUrl);
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.getByLabel(/token address, starts with z/).fill(TOKEN_ADDRESS);
  await page.getByRole('button', { name: en['land.open'] }).click();
  await expect(page.locator('.land__address')).toHaveText(/^bitcoincash:p[0-9a-z]{41}$/, { timeout: 20_000 });
  await expect(page.locator('svg.payqr')).toBeVisible();
  counts.land = bch.n;
  expect(bch.n).toBe(0);
});

test('Send out from PUSD through THORChain: the swap to BCH and the deposit', async ({ page }) => {
  test.setTimeout(60_000);
  const bch = bchSigned(page);
  await page.goto(crossUrl);
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await expect(page.getByRole('radio', { name: 'From PUSD' })).toHaveAttribute('aria-checked', 'true');
  await page.getByPlaceholder('0x…').fill(DEST);
  await expect(page.locator('.swap__receive')).toContainText(/You receive about [0-9.]+ USDC/, { timeout: 10_000 });
  await primary(page).click();
  await expect(primary(page)).toHaveText(en['out.go'], { timeout: 20_000 });
  await primary(page).click();
  await acceptDisclosure(page);
  await expect(page.locator('.swap__done')).toContainText('Sent.', { timeout: 30_000 });
  counts['out:thorchain'] = bch.n;
  expect(bch.n).toBe(2);
});

test('Bring in through THORChain: the approval and the router deposit', async ({ page }) => {
  test.setTimeout(60_000);
  const bch = bchSigned(page);
  await injectEvmWallet(page);
  await page.goto(crossUrl);
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.getByRole('button', { name: 'Test EVM wallet' }).click();
  await page.locator('.in .field__input').first().fill('5');
  await page.getByPlaceholder('bitcoincash:…').fill(BCH_ADDRESS);
  await expect(page.locator('.swap__receive')).toContainText(/At least [0-9.]+ BCH/, { timeout: 10_000 });
  await page.getByRole('button', { name: en['in.go'] }).click();
  await acceptDisclosure(page);
  await expect(page.locator('.swap__done')).toContainText('Sent.', { timeout: 20_000 });
  counts['in:thorchain'] = (await evmSent(page)) + bch.n;
  expect(counts['in:thorchain']).toBe(2);
});

test('Send out from PUSD through NEAR Intents: the swap to BCH and one transfer', async ({ page }) => {
  test.setTimeout(60_000);
  const bch = bchSigned(page);
  await page.goto(ocUrl);
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await page.getByPlaceholder('0x…').fill(DEST);
  await expect(row(page, 'near-intents').getByRole('radio')).toBeEnabled({ timeout: 10_000 });
  await row(page, 'near-intents').getByRole('radio').check();
  await primary(page).click();
  await expect(primary(page)).toHaveText(en['out.go'], { timeout: 20_000 });
  await primary(page).click();
  await acceptDisclosure(page);
  await expect(page.locator('.swap__done')).toContainText('Sent.', { timeout: 30_000 });
  counts['out:near-intents'] = bch.n;
  expect(bch.n).toBe(2);
});

test('Bring in through NEAR Intents: one plain transfer', async ({ page }) => {
  test.setTimeout(60_000);
  const bch = bchSigned(page);
  await injectEvmWallet(page);
  await page.goto(ocUrl);
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.getByRole('button', { name: 'Test EVM wallet' }).click();
  await page.locator('.in .field__input').first().fill('5');
  await page.getByPlaceholder('bitcoincash:…').fill(TOKEN_ADDRESS);
  await expect(row(page, 'near-intents').getByRole('radio')).toBeEnabled({ timeout: 10_000 });
  await row(page, 'near-intents').getByRole('radio').check();
  await page.getByRole('button', { name: en['in.go'] }).click();
  await acceptDisclosure(page);
  await expect(page.locator('.swap__done')).toContainText('Sent.', { timeout: 20_000 });
  counts['in:near-intents'] = (await evmSent(page)) + bch.n;
  expect(counts['in:near-intents']).toBe(1);
});

// eslint-disable-next-line no-empty-pattern -- Playwright passes the test info as the second argument only
test.afterAll(({}, info) => {
  const out = process.env.ROUTE_SIGNATURES_OUT;
  if (!out || info.project.name !== 'chromium-desktop') return;
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ counted_at: new Date().toISOString(), project: info.project.name, counts }, null, 2)}\n`);
});
