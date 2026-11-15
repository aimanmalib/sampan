// Measured mainnet swaps through the real page and the headless test wallet (G1, KP3 flow "swap").
//   npx tsx tools/measure/swap.ts [--rounds 3] [--bch 0.001] [--port 4183]
// Starts the built server (dist/) against the real network with the swap tab switched on, opens the page in
// Chromium, pairs the test wallet through the page's own WizardConnect link, then per round buys PUSD for the
// given BCH and sells the whole PUSD balance back. Each swap appends one row to docs/MEASURED.md, failures
// included, and the run stops at the first failure. The test wallet signs only what passes checkTransaction
// against what the page showed and stays inside state/budget.json.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';
import { BCH } from '../../core/check.js';
import { formatUnits, parseUnits } from '../../core/wallet.js';
import { loadConfig } from '../../server/config.js';
import { appendRuns, type Run } from './runs.js';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const ROUNDS = Number(arg('--rounds', '3'));
const BUY_BCH = arg('--bch', '0.001');
const PORT = Number(arg('--port', '4183'));
const BASE = `http://127.0.0.1:${PORT}`;
const INTENT_FILE = 'state/measure-intent.json';
const MEASURED = 'docs/MEASURED.md';
const SWAP_TIMEOUT_MS = 180_000;

const config = loadConfig('config/sampan.json');
const token = config.tokens[config.defaultToken]!;
const category = token.category.toLowerCase();

// Swap tab on; rate limits lifted because every request of the run comes from one local address.
const SERVER_PATCH = { features: { swap: true }, rate: { quotesPerMinute: 1000, crossingsPerHour: 1000 } };

function startServer(): ChildProcess {
  mkdirSync('state/measure-data', { recursive: true });
  const child = spawn('node', ['dist/server/main.js'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', SAMPAN_DATA: 'state/measure-data', SAMPAN_CONFIG_PATCH: JSON.stringify(SERVER_PATCH) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return child;
}

async function waitHealthy(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`${BASE}/healthz`).then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

async function quote(side: 'buy' | 'sell', amount: bigint): Promise<{ usd: number; minReceive: string }> {
  const res = await fetch(`${BASE}/api/swap/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ token: token.symbol, side, amount: amount.toString() }),
  });
  const body = (await res.json()) as { quote?: { usd: number; minReceive: string } };
  if (!body.quote) throw new Error(`quote failed: ${JSON.stringify(body)}`);
  return body.quote;
}

const primary = (page: Page) => page.locator('.button--primary');

/**
 * The "at least" amount the page shows, in base units of the asset received. Waits until the line names the
 * asset of this side and agrees with a fresh quote for the same amount, so a line left from the previous
 * form state is never taken.
 */
async function shownMinimum(page: Page, asset: string, decimals: number, fresh: () => Promise<bigint>): Promise<bigint> {
  const pattern = new RegExp(`at least ([0-9.]+) ${asset}\\.`);
  for (let i = 0; i < 30; i++) {
    const m = pattern.exec((await page.locator('.swap__receive').textContent()) ?? '');
    const shown = m ? parseUnits(m[1]!, decimals) : undefined;
    if (shown !== undefined && shown === (await fresh())) return shown;
    await page.waitForTimeout(1000);
  }
  throw new Error(`the page shows no current minimum in ${asset}`);
}

async function walletTokens(page: Page): Promise<bigint> {
  const text = (await page.locator('.swap__wallet').textContent()) ?? '';
  const m = new RegExp(`and ([0-9.]+) ${token.symbol}`).exec(text);
  return m ? (parseUnits(m[1]!, token.decimals) ?? 0n) : 0n;
}

/** Fills the form, writes the intent the test wallet will hold the page to, presses Swap and records the row. */
async function swapOnce(page: Page, side: 'buy' | 'sell', amount: bigint): Promise<Run> {
  const payDecimals = side === 'buy' ? 8 : token.decimals;
  const getDecimals = side === 'buy' ? token.decimals : 8;
  await page.getByRole('radio', { name: side === 'buy' ? `BCH to ${token.symbol}` : `${token.symbol} to BCH` }).click();
  await page.getByRole('textbox').fill(formatUnits(amount, payDecimals));
  let usd = 0;
  const fresh = async (): Promise<bigint> => {
    const q = await quote(side, amount);
    usd = q.usd;
    return BigInt(q.minReceive);
  };
  const min = await shownMinimum(page, side === 'buy' ? token.symbol : 'BCH', getDecimals, fresh);
  const intent = {
    spend: side === 'buy' ? { sats: amount.toString() } : { sats: '0', tokens: { [category]: amount.toString() } },
    receive: { category: side === 'buy' ? category : BCH, min: min.toString() },
    usd: Math.round(usd * 100) / 100,
  };
  writeFileSync(INTENT_FILE, JSON.stringify(intent));
  const label =
    side === 'buy'
      ? `${formatUnits(amount, 8)} BCH to at least ${formatUnits(min, token.decimals)} ${token.symbol}`
      : `${formatUnits(amount, token.decimals)} ${token.symbol} to at least ${formatUnits(min, 8)} BCH`;
  const started = Date.now();
  await primary(page).click();
  const done = page.locator('.swap__done');
  const failed = page.locator('.swap__error');
  await done.or(failed).first().waitFor({ timeout: SWAP_TIMEOUT_MS });
  const seconds = (Date.now() - started) / 1000;
  if (!(await done.isVisible())) return { utc: new Date(), flow: 'swap', amount: label, seconds, ok: false, note: (await failed.textContent()) ?? 'error' };
  const href = (await page.getByRole('link', { name: 'View on explorer' }).getAttribute('href')) ?? '';
  const txid = /[0-9a-f]{64}$/.exec(href)?.[0];
  const run: Run = { utc: new Date(), flow: 'swap', amount: label, seconds, ok: txid !== undefined };
  return txid ? { ...run, txid } : { ...run, note: 'no txid shown' };
}

async function main(): Promise<void> {
  const server = startServer();
  let wallet: ChildProcess | undefined;
  const browser = await chromium.launch();
  try {
    await waitHealthy();
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
    // A string, so the bundler's helpers never reach the page. The page's "Copy link" lands in window.__copied.
    await page.addInitScript(
      "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });",
    );
    await page.goto(BASE);
    await primary(page).click();
    await page.getByRole('button', { name: 'Copy link' }).click();
    const uri = String(await page.evaluate('window.__copied || ""'));
    if (!uri.startsWith('wiz')) throw new Error('no pairing link on the page');
    writeFileSync(INTENT_FILE, '{}');
    const signatures = String(Math.max(1, ROUNDS * 2));
    wallet = spawn(process.execPath, ['--import', 'tsx', 'tools/test-wallet/connect.ts', uri, INTENT_FILE, '--timeout-seconds', '1200', '--signatures', signatures], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    await page.locator('.swap__wallet').filter({ hasText: 'In your wallet' }).waitFor({ timeout: 90_000 });
    console.log(await page.locator('.swap__wallet').textContent());
    const buySats = parseUnits(BUY_BCH, 8)!;
    for (let round = 1; round <= ROUNDS; round++) {
      const tokensBefore = await walletTokens(page);
      const buy = await swapOnce(page, 'buy', buySats);
      appendRuns(MEASURED, [buy]);
      console.log(`round ${round} buy: ${buy.ok ? 'ok' : 'fail'} ${buy.txid ?? buy.note ?? ''} ${buy.seconds?.toFixed(1)} s`);
      if (!buy.ok) break;
      await page.getByRole('button', { name: 'Swap again' }).click();
      await page.locator('.swap__wallet').filter({ hasNotText: `and ${formatUnits(tokensBefore, token.decimals, token.decimals)} ${token.symbol}` }).waitFor({ timeout: 60_000 });
      const sell = await swapOnce(page, 'sell', await walletTokens(page));
      appendRuns(MEASURED, [sell]);
      console.log(`round ${round} sell: ${sell.ok ? 'ok' : 'fail'} ${sell.txid ?? sell.note ?? ''} ${sell.seconds?.toFixed(1)} s`);
      if (!sell.ok) break;
      await page.getByRole('button', { name: 'Swap again' }).click();
      await page.locator('.swap__wallet').filter({ hasText: `and 0.00 ${token.symbol}` }).waitFor({ timeout: 60_000 });
    }
  } finally {
    wallet?.kill();
    await browser.close();
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
