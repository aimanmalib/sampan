// Measured mainnet landings (G2, KP3 flow "land"): BCH paid to a landing address arrives at the owner as PUSD.
//   npx tsx tools/measure/land.ts [--wallet 1] [--plain 2] [--bch 0.001] [--port 4184]
// Starts the built server (dist/) against the real network with the Bring in tab switched on; its own finisher
// converts what arrives. Each landing is opened through the real page in Chromium:
//   --wallet runs: the test wallet pairs through the page's WizardConnect link, the page opens the address for
//                  the connected wallet and pays it with "Pay from connected wallet" (the wallet signs only what
//                  checkTransaction approves against the landing address the page computed);
//   --plain runs:  the owner address is typed into the form and the test wallet pays the shown address as a
//                  plain BCH payment from its own coins (tools/test-wallet/send.ts), as any wallet would.
// Owners are different receive addresses of the test wallet, so every run gets its own landing address.
// `seconds` runs from the payment broadcast to the server reporting the conversion; the row is ok only when the
// conversion output with the tokens is found at the owner's address on chain.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { parseAddress } from '../../core/address.js';
import { cardFromFragment } from '../../core/landing-card.js';
import { hdKeysFromPhrase } from '../../core/client/session.js';
import { deriveAddress, formatUnits, parseUnits } from '../../core/wallet.js';
import { ElectrumChain } from '../../server/chain/electrum.js';
import { loadConfig } from '../../server/config.js';
import { SECRET_KEYS, parseEnv } from '../test-wallet/keys.js';
import { appendRuns, type Run } from './runs.js';
import { CLIPBOARD_SPY, startServer, waitHealthy } from './server.js';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const WALLET_RUNS = Number(arg('--wallet', '1'));
const PLAIN_RUNS = Number(arg('--plain', '2'));
const PAY_BCH = arg('--bch', '0.001');
const PORT = Number(arg('--port', '4184'));
const BASE = `http://127.0.0.1:${PORT}`;
const INTENT_FILE = 'state/measure-intent.json';
const MEASURED = 'docs/MEASURED.md';
const FINISH_TIMEOUT_MS = 15 * 60_000;

const config = loadConfig('config/sampan.json');
const token = config.tokens[config.defaultToken]!;
const category = token.category.toLowerCase();
const en = JSON.parse(readFileSync('lang/en.json', 'utf8')) as Record<string, string>;

// Public addresses only: the phrase stays in this process and in the test wallet's.
const env = parseEnv(readFileSync(path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env'), 'utf8'));
const phrase = env.get(SECRET_KEYS.bchMainnet);
if (!phrase) throw new Error(`${SECRET_KEYS.bchMainnet} is missing from the env file`);
const keys = hdKeysFromPhrase(phrase);
const receive = (i: number) => deriveAddress(keys.publicKey('receive', i), 'receive', i, 'bitcoincash');

const SERVER_PATCH = {
  features: { landing: true },
  ops: { testAddresses: Array.from({ length: 8 }, (_, i) => receive(i).address) },
};

// Plain runs pay to receive/5, receive/6, ...: inside the scan gap, away from the wallet's next receive address.
const PLAIN_OWNER_FIRST = 5;

const primary = (page: Page) => page.locator('.button--primary');
const sats = parseUnits(PAY_BCH, 8)!;

async function usdOf(amount: bigint): Promise<number> {
  const res = await fetch(`${BASE}/api/swap/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ token: token.symbol, side: 'buy', amount: amount.toString() }),
  });
  const body = (await res.json()) as { quote?: { usd: number } };
  if (!body.quote) throw new Error(`quote failed: ${JSON.stringify(body)}`);
  return Math.round(body.quote.usd * 100) / 100;
}

async function openBringIn(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.addInitScript(CLIPBOARD_SPY);
  await page.goto(BASE);
  await page.getByRole('tab', { name: en['tabs.in']! }).click();
  return page;
}

interface Shown {
  address: string;
  lockHex: string;
  crossingId: string;
  /** Owner lock from the recovery card in the status link. */
  ownerLock: string;
  /** Finishing transaction already on the crossing when this owner and rate had an address before. */
  earlierTxid?: string;
}

/** Reads the landing address the page shows, and the crossing id and recovery card from its "Follow this landing" link. */
async function shownLanding(page: Page): Promise<Shown> {
  const address = ((await page.locator('.land__address').textContent({ timeout: 30_000 })) ?? '').trim();
  const parsed = parseAddress(address, 'bitcoincash');
  if (typeof parsed === 'string') throw new Error(`the page shows no landing address: ${parsed}`);
  const href = (await page.getByRole('link', { name: en['land.follow']! }).getAttribute('href')) ?? '';
  const crossingId = /\/c\/([0-9a-f]{32})/.exec(href)?.[1];
  const card = cardFromFragment(href.split('#card=')[1] ?? '');
  if (!crossingId || typeof card === 'string') throw new Error('no status link with a recovery card on the page');
  if (card.card.address !== address) throw new Error('the card names another address');
  const earlier = (await fetch(`${BASE}/api/crossings/${crossingId}`).then((r) => r.json())) as { txid?: string | null };
  return { address, lockHex: parsed.lockingHex, crossingId, ownerLock: card.params.ownerLockHex, ...(earlier.txid ? { earlierTxid: earlier.txid } : {}) };
}

/** Polls the crossing until the server reports a new conversion or return. */
async function waitFinished(shown: Shown): Promise<{ status: string; txid?: string }> {
  const until = Date.now() + FINISH_TIMEOUT_MS;
  while (Date.now() < until) {
    const c = (await fetch(`${BASE}/api/crossings/${shown.crossingId}`).then((r) => r.json())) as { status: string; txid?: string };
    if ((c.status === 'converted' || c.status === 'returned') && c.txid !== shown.earlierTxid) return c;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { status: 'timeout' };
}

/** The conversion output at the owner: output 0 of the finishing transaction, carrying the token. */
async function tokensAtOwner(chain: ElectrumChain, ownerLock: string, txid: string): Promise<bigint | undefined> {
  for (let i = 0; i < 10; i++) {
    const hit = (await chain.listUnspent(ownerLock)).find((u) => u.txid === txid && u.vout === 0);
    if (hit) return hit.token?.category.toLowerCase() === category ? hit.token.amount : undefined;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return undefined;
}

async function finishRow(chain: ElectrumChain, how: string, shown: Shown, paidAt: number): Promise<Run> {
  const done = await waitFinished(shown);
  const seconds = (Date.now() - paidAt) / 1000;
  const label = (tokens?: bigint) => `${PAY_BCH} BCH to ${tokens === undefined ? '?' : formatUnits(tokens, token.decimals, token.decimals)} ${token.symbol} (${how})`;
  if (done.status !== 'converted' || !done.txid) return { utc: new Date(), flow: 'land', amount: label(), seconds, ok: false, note: `server status ${done.status}` };
  const tokens = await tokensAtOwner(chain, shown.ownerLock, done.txid);
  const run: Run = { utc: new Date(), flow: 'land', amount: label(tokens), txid: done.txid, seconds, ok: tokens !== undefined };
  return tokens === undefined ? { ...run, note: 'tokens not found at the owner address' } : run;
}

async function walletRun(browser: Browser, chain: ElectrumChain): Promise<Run> {
  const page = await openBringIn(browser);
  let wallet: ChildProcess | undefined;
  try {
    await primary(page).click();
    await page.getByRole('button', { name: 'Copy link' }).click();
    const uri = String(await page.evaluate('window.__copied || ""'));
    if (!uri.startsWith('wiz')) throw new Error('no pairing link on the page');
    writeFileSync(INTENT_FILE, '{}');
    wallet = spawn(process.execPath, ['--import', 'tsx', 'tools/test-wallet/connect.ts', uri, INTENT_FILE, '--timeout-seconds', '600'], { stdio: ['ignore', 'inherit', 'inherit'] });
    await page.locator('.land__owner').filter({ hasText: 'Paid to your connected wallet' }).waitFor({ timeout: 90_000 });
    await primary(page).click();
    const shown = await shownLanding(page);
    await page.getByRole('textbox').fill(PAY_BCH);
    const intent = {
      spend: { sats: sats.toString() },
      receive: { category, min: '0' },
      deposits: [{ lockingBytecode: shown.lockHex, sats: sats.toString() }],
      usd: await usdOf(sats),
    };
    writeFileSync(INTENT_FILE, JSON.stringify(intent));
    await primary(page).click();
    await page.waitForURL(/\/c\/[0-9a-f]{32}/, { timeout: 180_000 });
    const paidAt = Date.now();
    console.log(`wallet paid ${shown.address}`);
    return await finishRow(chain, 'wallet pays through WizardConnect', shown, paidAt);
  } finally {
    wallet?.kill();
    await page.close();
  }
}

async function plainRun(browser: Browser, chain: ElectrumChain, ownerIndex: number): Promise<Run> {
  const page = await openBringIn(browser);
  try {
    const owner = receive(ownerIndex);
    await page.locator('.field__input--address').fill(owner.tokenAddress);
    await primary(page).click();
    const shown = await shownLanding(page);
    const usd = await usdOf(sats);
    const send = spawn(process.execPath, ['--import', 'tsx', 'tools/test-wallet/send.ts', shown.address, PAY_BCH, '--usd', String(usd), '--why', `Pay ${PAY_BCH} BCH to a landing address`], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const code = await new Promise<number | null>((r) => send.on('exit', r));
    if (code !== 0) return { utc: new Date(), flow: 'land', amount: `${PAY_BCH} BCH (plain payment)`, ok: false, note: 'the payment was not sent' };
    const paidAt = Date.now();
    console.log(`plain payment to ${shown.address}`);
    if (shown.ownerLock !== owner.lockingHex) throw new Error('the card pays someone else');
    return await finishRow(chain, 'plain payment', shown, paidAt);
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const server = startServer({ port: PORT, dataDir: 'state/measure-land', patch: SERVER_PATCH });
  const chain = new ElectrumChain(config.electrum.servers);
  const browser = await chromium.launch();
  try {
    await waitHealthy(BASE);
    const plan = [...Array<'wallet'>(WALLET_RUNS).fill('wallet'), ...Array<'plain'>(PLAIN_RUNS).fill('plain')];
    for (const [i, kind] of plan.entries()) {
      const run = kind === 'wallet' ? await walletRun(browser, chain) : await plainRun(browser, chain, PLAIN_OWNER_FIRST + i);
      appendRuns(MEASURED, [run]);
      console.log(`${kind}: ${run.ok ? 'ok' : 'fail'} ${run.txid ?? run.note ?? ''} ${run.seconds?.toFixed(1) ?? '-'} s`);
      if (!run.ok) break;
    }
  } finally {
    await browser.close();
    await chain.close();
    server.kill();
  }
}

void main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
