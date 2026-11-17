// Running the atomic swap (USDC on Base to PUSD) inside Bring in, against the cross-chain fake server. The service is
// answered by page.route (health and quote from frozen fixtures; the offer built here from the page's own request),
// Base's clock by a stand-in RPC answer, and the wallet is a fake EIP-6963 provider. The client file is the real
// minified build, so its own checks run: the recovery card must be downloaded before the lock button works, an offer
// for another contract stops before anything is signed, the card is kept under the service page's storage key, and
// the refund button shows only once Base's clock is past the lock's timeout, then asks the relay.
// Skipped against a live site.
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { encodeAbiParameters, getAddress, keccak256 } from 'viem';
import en from '../lang/en.json' with { type: 'json' };

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

const outPort = Number(process.env.E2E_PORT ?? 4173) + 2;
test.use({ baseURL: `http://127.0.0.1:${outPort}` });

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/atom/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
const HEALTH = fixture('health.json');
const QUOTE = fixture('quote-usdc-to-pusd.json');

const EVM_ADDRESS = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const BCH_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const ATOM_LOCK = '0x195748691cBD8f47794d03f2992Bc988314af7C3';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MAKER = '0xf7588BCe84186EBACF479527c7fdf8d569a8B13e';
const STORAGE_KEY = 'sampan-atom-cards';
const NOW = Math.floor(Date.now() / 1000);

interface Service {
  /** Swap state the service reports on the next poll. */
  state: string;
  hash: string | null;
  offers: number;
  /** Unix seconds by which the user had to lock, as the service reports it. */
  lockBy: number;
  /** Base's latest block time as the client reads it. */
  clock: number;
  relays: Array<{ hash: string; action: string }>;
}

/** A wallet extension stand-in on Ethereum mainnet first; it switches to Base when asked and records what it signs. */
async function injectWallet(page: Page): Promise<void> {
  await page.addInitScript((account) => {
    const sent: Array<{ to: string; data: string }> = [];
    let chain = '0x1';
    const provider = {
      async request({ method, params }: { method: string; params?: Array<Record<string, string>> }) {
        const p = params ?? [];
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
        if (method === 'eth_chainId') return chain;
        if (method === 'wallet_switchEthereumChain') return void (chain = p[0]!.chainId!);
        if (method === 'wallet_revokePermissions') return null;
        if (method === 'eth_sendTransaction') {
          sent.push({ to: p[0]!.to!, data: p[0]!.data! });
          return `0x${String(sent.length).padStart(64, '2')}`;
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
    (window as unknown as { __evmSent: typeof sent }).__evmSent = sent;
  }, EVM_ADDRESS);
}

/** The lock the maker offers for the page's request; `atomLock` other than the shipped one makes a bad offer. */
function offerFor(body: { hash: string; userEvm: string; amount: string }, atomLock: string) {
  const amount = BigInt(Math.round(Number(body.amount) * 1e6));
  const timeout = BigInt(NOW + 3600);
  const sender = getAddress(body.userEvm);
  const id = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'uint256' }],
      [sender, MAKER, USDC, amount, `0x${body.hash}`, timeout],
    ),
  );
  const lock = {
    chain: 'base', chainId: 8453, atomLock, id,
    terms: { sender, recipient: MAKER, token: USDC, amount: amount.toString(), hash: body.hash, timeout: timeout.toString() },
    timeout: { chain: 'base', unixSeconds: Number(timeout) },
  };
  return { lock, swap: swapView(body.hash, 'offered', lock) };
}

function swapView(hash: string, state: string, userLock: unknown = {}, lockBy = NOW + 1800) {
  return {
    hash, flow: 'usdc-to-pusd', state, amountIn: '2', amountOut: '1.98', symbolIn: 'USDC', symbolOut: 'PUSD', userChain: 'base', userLock,
    lockBy, makerLock: null, declined: null, secretSeen: false, retrying: false, tx: {}, times: {},
  };
}

async function setUp(page: Page, opts: { atomLock?: string } = {}): Promise<Service> {
  const svc: Service = { state: 'offered', hash: null, offers: 0, lockBy: NOW + 1800, clock: NOW, relays: [] };
  await injectWallet(page);
  await page.route('**/api/config', async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { features: Record<string, boolean>; atom: { flows: string[]; pollSeconds: number } };
    body.features.atom = true;
    body.atom.flows = ['usdc-to-pusd'];
    body.atom.pollSeconds = 1;
    await route.fulfill({ response: res, json: body });
  });
  await page.route('**/atom/api/**', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/health')) return route.fulfill({ json: HEALTH });
    if (url.pathname.endsWith('/quote')) return route.fulfill({ json: { ...QUOTE, amountIn: url.searchParams.get('amount') } });
    if (url.pathname.endsWith('/offer')) {
      svc.offers += 1;
      const body = route.request().postDataJSON() as { hash: string; userEvm: string; amount: string };
      svc.hash = body.hash;
      return route.fulfill({ status: 201, json: offerFor(body, opts.atomLock ?? ATOM_LOCK) });
    }
    const swap = /\/swap\/([0-9a-f]{64})$/.exec(url.pathname);
    if (swap) return route.fulfill({ json: { swap: swapView(swap[1]!, svc.state, {}, svc.lockBy) } });
    if (url.pathname.endsWith('/relay')) {
      const body = route.request().postDataJSON() as { hash: string; action: string };
      svc.relays.push(body);
      svc.state = 'refunded';
      return route.fulfill({ json: { txid: `0x${'77'.repeat(32)}`, swap: swapView(body.hash, 'refunded', {}, svc.lockBy) } });
    }
    return route.fulfill({ status: 404, json: { reason: 'not-found' } });
  });
  // Base's clock as the client reads it (latest block), through the RPCs in the client's own config.
  await page.route(/https:\/\/(mainnet\.base\.org|base-rpc\.publicnode\.com)\/?$/, async (route: Route) => {
    const req = route.request().postDataJSON() as { id: number; method: string };
    if (req.method !== 'eth_getBlockByNumber') return route.fulfill({ json: { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'not here' } } });
    const hex = (n: number) => `0x${n.toString(16)}`;
    const block = {
      number: hex(30_000_000), hash: `0x${'11'.repeat(32)}`, parentHash: `0x${'22'.repeat(32)}`, timestamp: hex(svc.clock), gasLimit: hex(1), gasUsed: hex(0),
      baseFeePerGas: hex(1), transactions: [], difficulty: '0x0', extraData: '0x', logsBloom: `0x${'00'.repeat(256)}`, miner: MAKER, nonce: '0x0000000000000000',
      receiptsRoot: `0x${'33'.repeat(32)}`, sha3Uncles: `0x${'44'.repeat(32)}`, size: hex(1), stateRoot: `0x${'55'.repeat(32)}`, transactionsRoot: `0x${'66'.repeat(32)}`, uncles: [],
    };
    return route.fulfill({ json: { jsonrpc: '2.0', id: req.id, result: block } });
  });
  return svc;
}

/** Bring in tab, wallet connected, 2 USDC to the test address, atom row picked. */
async function pickAtom(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.getByRole('button', { name: 'Test EVM wallet' }).click();
  await expect(page.locator('.evm__who')).toContainText('Connected with Test EVM wallet');
  await page.getByPlaceholder('bitcoincash:…').fill(BCH_ADDRESS);
  const quote = page.waitForResponse((r) => r.url().includes('/atom/api/quote'));
  await page.locator('.in .field__input').first().fill('2');
  await quote;
  await page.locator('.routes__row[data-route="atom"]').getByRole('radio').check();
}

const sentCount = (page: Page) => page.evaluate(() => (window as unknown as { __evmSent: unknown[] }).__evmSent.length);
const stored = (page: Page) => page.evaluate((key) => Object.keys(JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>), STORAGE_KEY);
const lockButton = (page: Page) => page.getByRole('button', { name: en['atom.lock'].replace('{amount}', '2').replace('{symbol}', 'USDC') });

test('the card is downloaded before the lock works; the page locks, follows the swap and lists it to continue', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const svc = await setUp(page);
  await pickAtom(page);
  await page.getByRole('button', { name: en['atom.go'] }).click();

  await expect(page.getByRole('heading', { name: en['atom.card.title'] })).toBeVisible();
  await expect(page.locator('.atom-run .swap__receive')).toHaveText(en['atom.receive'].replace('{amount}', '1.98'));
  await expect(lockButton(page)).toBeDisabled();
  expect(await stored(page)).toEqual([svc.hash]);
  expect(await sentCount(page)).toBe(0);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: en['atom.card.download'] }).click();
  expect((await download).suggestedFilename()).toBe(`sampan-recovery-${svc.hash!.slice(0, 12)}.json`);
  await expect(page.getByText(en['atom.card.saved'])).toBeVisible();
  expect(await sentCount(page)).toBe(0);

  svc.state = 'userLocked';
  await lockButton(page).click();
  await expect(page.locator('.atom-run__state')).toHaveText(en['atom.state.userLocked'], { timeout: 15_000 });
  const sent = await page.evaluate(() => (window as unknown as { __evmSent: Array<{ to: string; data: string }> }).__evmSent);
  expect(sent.map((s) => s.data.slice(0, 10))[0]).toBe('0x095ea7b3');
  expect(sent).toHaveLength(2);
  expect(getAddress(sent[1]!.to)).toBe(ATOM_LOCK);

  svc.state = 'done';
  await expect(page.locator('.atom-run__state')).toHaveText(en['atom.state.done'], { timeout: 15_000 });

  // A new visit lists the swap from the same storage key, and Continue follows it again.
  await pickAtom(page);
  const item = page.locator('.atom-run__item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('2 USDC, started');
  await item.getByRole('button', { name: en['atom.pending.continue'] }).click();
  await expect(page.locator('.atom-run__state')).toHaveText(en['atom.state.done'], { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('an offer for another contract stops before the card and before anything is signed', async ({ page }) => {
  const svc = await setUp(page, { atomLock: '0x0000000000000000000000000000000000000001' });
  await pickAtom(page);
  await page.getByRole('button', { name: en['atom.go'] }).click();
  await expect(page.locator('.atom-run .swap__error')).toHaveText(en['atom.err.offer'].replace('{code}', 'wrong-contract'));
  expect(svc.offers).toBe(1);
  await expect(lockButton(page)).toHaveCount(0);
  expect(await stored(page)).toEqual([]);
  expect(await sentCount(page)).toBe(0);
  await page.setViewportSize({ width: 320, height: 640 });
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
});

test('the refund shows only once Base is past the lock timeout, and goes through the relay', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const svc = await setUp(page);
  await pickAtom(page);
  await page.getByRole('button', { name: en['atom.go'] }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: en['atom.card.download'] }).click();
  await download;
  svc.state = 'userLocked';
  await lockButton(page).click();
  await expect(page.locator('.atom-run__state')).toHaveText(en['atom.state.userLocked'], { timeout: 15_000 });

  // The time to lock is over but Base's clock is still before the lock's timeout (NOW + 3600): no button.
  svc.lockBy = NOW - 10;
  // A clock read after a poll, then the next poll: the page has settled on that reading.
  await page.waitForResponse((r) => /base/.test(new URL(r.url()).hostname) && r.request().postData()?.includes('eth_getBlockByNumber') === true);
  await page.waitForResponse((r) => r.url().includes('/atom/api/swap/'));
  const refund = page.getByRole('button', { name: en['atom.refund.go'] });
  await expect(refund).toHaveCount(0);
  expect(svc.relays).toEqual([]);

  svc.clock = NOW + 3601;
  await expect(refund).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(en['atom.refund.ready'])).toBeVisible();
  await refund.click();
  await expect(page.locator('.atom-run__state')).toHaveText(en['atom.state.refunded'], { timeout: 15_000 });
  expect(svc.relays).toEqual([{ hash: svc.hash, action: 'refund' }]);
  await expect(refund).toHaveCount(0);
  expect(errors).toEqual([]);
});
