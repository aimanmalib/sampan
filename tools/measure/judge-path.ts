// The judge path stopwatch (KP23): how long a judge needs on the live site until a real mainnet transaction id is
// on screen, in WebKit on an iPhone 13 and in Chromium on a 1440x900 desktop.
//   npx tsx tools/measure/judge-path.ts [--engine webkit-iphone13|chromium-desktop|both] [--path see|do|both]
//     [--base https://sampan.sasateguh.com] [--commit <short hash>] [--write]
// see: no wallet. Front page, then the judge strip's "Or see the transactions already made" link, until the first transaction id link of the proof
//      table is inside the viewport.
// do:  the headless test wallet pairs through the page's own Copy link, then the page's default swap
//      (limits.judgeSwapBch, BCH to PUSD) is sent, until "View on explorer" with the broadcast txid is on screen.
//      The test wallet signs only what passes checkTransaction against what the page showed, inside
//      state/budget.json. A person's time in a wallet cannot be measured by a machine: those steps are counted.
// Time spent by this script itself (screenshots, writing the wallet's intent) is taken off the clock. Screenshots of
// every step go to state/judge-path/ (not tracked). With --write each timed path adds one row to the Judge path table
// of docs/MEASURED.md, and each "do" swap, failed or not, adds one row to the Runs table.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, devices, webkit, type Browser, type BrowserContextOptions, type Locator, type Page } from '@playwright/test';
import en from '../../lang/en.json' with { type: 'json' };
import { formatUnits, parseUnits } from '../../core/wallet.js';
import { loadConfig } from '../../server/config.js';
import { appendJudge, countActions, ENGINES, PATHS, type Engine, type JudgePath, type JudgeRow, type Step } from './judge-table.js';
import { appendRuns, type Run } from './runs.js';
import { CLIPBOARD_SPY } from './server.js';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const pick = <T extends string>(value: string, all: readonly T[]): T[] =>
  value === 'both' ? [...all] : all.includes(value as T) ? [value as T] : (() => { throw new Error(`unknown value ${value}`); })();

const BASE = arg('--base', 'https://sampan.sasateguh.com').replace(/\/$/, '');
const ENGINE_LIST = pick(arg('--engine', 'both'), ENGINES);
const PATH_LIST = pick(arg('--path', 'both'), PATHS);
const COMMIT = arg('--commit', readFileSync('deploy/CURRENT_TAG', 'utf8').trim().split('-')[0]!);
const WRITE = process.argv.includes('--write');
const SHOTS = 'state/judge-path';
const INTENT_FILE = 'state/measure-intent.json';
const MEASURED = 'docs/MEASURED.md';
const STEP_TIMEOUT_MS = 60_000;
const SWAP_TIMEOUT_MS = 180_000;
/** What a person does in a wallet on the "do" path: paste the link, accept the connection, approve the swap. */
const WALLET_STEPS = ['paste the Copy link text in the wallet', 'accept the connection in the wallet', 'approve the swap in the wallet'];

const config = loadConfig('config/sampan.json');
const token = config.tokens[config.defaultToken]!;
const category = token.category.toLowerCase();

const CONTEXTS: Record<Engine, { launch: () => Promise<Browser>; options: BrowserContextOptions }> = {
  'webkit-iphone13': { launch: () => webkit.launch(), options: { ...devices['iPhone 13'] } },
  'chromium-desktop': { launch: () => chromium.launch(), options: { viewport: { width: 1440, height: 900 } } },
};

/** A stopwatch that can be paused while the script does its own work, with a screenshot per step. */
class Clock {
  readonly steps: Step[] = [];
  private start = 0;
  private paused = 0;
  constructor(private readonly page: Page, private readonly prefix: string) {}
  begin(): void {
    this.start = performance.now();
  }
  now(): number {
    return (performance.now() - this.start - this.paused) / 1000;
  }
  async offClock<T>(work: () => Promise<T>): Promise<T> {
    const t = performance.now();
    try {
      return await work();
    } finally {
      this.paused += performance.now() - t;
    }
  }
  async step(kind: Step['kind'], what: string): Promise<void> {
    const at = this.now();
    this.steps.push({ at, kind, what });
    const n = String(this.steps.length).padStart(2, '0');
    await this.offClock(() => this.page.screenshot({ path: `${this.prefix}-${n}-${kind}.png` }).then(() => undefined, () => undefined));
  }
}

async function inViewport(page: Page, target: Locator, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  do {
    const inside = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
    }).catch(() => false);
    if (inside) return true;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  return false;
}

/** Scrolls to an element only when it is not on screen yet; the scroll is a person's action. */
async function bringIntoView(page: Page, clock: Clock, target: Locator, what: string, waitMs = 0): Promise<void> {
  if (await inViewport(page, target, waitMs)) return;
  await target.scrollIntoViewIfNeeded();
  await clock.step('scroll', what);
}

async function see(page: Page, clock: Clock): Promise<string> {
  clock.begin();
  await page.goto(BASE, { waitUntil: 'load' });
  await clock.step('load', 'front page loaded');
  // The judge strip's proof link: folded under its title on phones (one tap to open), open on tall wide screens.
  const strip = page.locator('.judge');
  await strip.waitFor({ timeout: STEP_TIMEOUT_MS });
  const how = strip.getByRole('link', { name: en['judge.proof'] });
  if (!(await how.isVisible())) {
    await page.locator('.judge__title').click();
    await clock.step('click', `"${en['judge.title']}" (opens the steps)`);
  }
  await bringIntoView(page, clock, how, `scroll to "${en['judge.proof']}"`);
  await how.click();
  await clock.step('click', `"${en['judge.proof']}"`);
  // Each transaction id in the proof table is a link to an explorer, written in the mono face.
  const txid = page.locator('#proof .proof__table--flows a.mono').first();
  await txid.waitFor({ timeout: STEP_TIMEOUT_MS });
  // The page jumps to #proof itself once its config has arrived: give it that moment before a person would scroll.
  await bringIntoView(page, clock, txid, 'scroll to the first transaction id', 2000);
  await clock.step('wait', 'transaction id link on screen');
  return (await txid.getAttribute('href')) ?? '';
}

async function quoteUsd(): Promise<number> {
  const amount = parseUnits(config.limits.judgeSwapBch, 8)!;
  const res = await fetch(`${BASE}/api/swap/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ token: token.symbol, side: 'buy', amount: amount.toString() }),
  });
  const body = (await res.json()) as { quote?: { usd: number } };
  if (!body.quote) throw new Error(`quote failed: ${JSON.stringify(body)}`);
  return Math.round(body.quote.usd * 100) / 100;
}

async function doSwap(page: Page, clock: Clock, wallet: { child?: ChildProcess }): Promise<Run> {
  const amount = parseUnits(config.limits.judgeSwapBch, 8)!;
  const label = (min?: bigint) =>
    `${formatUnits(amount, 8)} BCH to at least ${min === undefined ? '?' : formatUnits(min, token.decimals)} ${token.symbol} · judge path`;
  clock.begin();
  await page.goto(BASE, { waitUntil: 'load' });
  await clock.step('load', 'front page loaded');
  const primary = page.locator('.button--primary');
  const connectText = (await primary.textContent())?.trim() ?? '';
  await primary.click();
  await clock.step('click', `"${connectText}"`);
  await page.getByRole('button', { name: en['wallet.copyLink'] }).click();
  await clock.step('click', `"${en['wallet.copyLink']}"`);
  const uri = String(await page.evaluate('window.__copied || ""'));
  if (!uri.startsWith('wiz')) throw new Error('no pairing link on the page');
  await clock.offClock(async () => {
    writeFileSync(INTENT_FILE, '{}');
    wallet.child = spawn(process.execPath, ['--import', 'tsx', 'tools/test-wallet/connect.ts', uri, INTENT_FILE, '--timeout-seconds', '300', '--signatures', '1'], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  });
  await clock.step('wallet', WALLET_STEPS[0]!);
  await clock.step('wallet', WALLET_STEPS[1]!);
  await page.locator('.swap__wallet').filter({ hasText: 'In your wallet' }).waitFor({ timeout: 90_000 });
  await clock.step('wait', 'wallet connected, balance shown');
  const box = page.getByRole('textbox');
  if ((await box.inputValue()) !== config.limits.judgeSwapBch) {
    await box.fill(config.limits.judgeSwapBch);
    await clock.step('type', `amount ${config.limits.judgeSwapBch} BCH`);
  }
  const pattern = new RegExp(`at least ([0-9.]+) ${token.symbol}\\.`);
  await page.locator('.swap__receive').filter({ hasText: pattern }).waitFor({ timeout: STEP_TIMEOUT_MS });
  await clock.step('wait', 'quote shown');
  const min = parseUnits(pattern.exec((await page.locator('.swap__receive').textContent()) ?? '')![1]!, token.decimals)!;
  // What the test wallet holds the page to: exactly the amount and minimum the page shows.
  await clock.offClock(async () => {
    const intent = { spend: { sats: amount.toString() }, receive: { category, min: min.toString() }, usd: await quoteUsd() };
    writeFileSync(INTENT_FILE, JSON.stringify(intent));
  });
  const started = Date.now();
  await primary.click();
  await clock.step('click', `"${en['swap.go']}"`);
  await clock.step('wallet', WALLET_STEPS[2]!);
  const done = page.locator('.swap__done');
  const failed = page.locator('.swap__error');
  await done.or(failed).first().waitFor({ timeout: SWAP_TIMEOUT_MS });
  const seconds = (Date.now() - started) / 1000;
  if (!(await done.isVisible())) return { utc: new Date(), flow: 'swap', amount: label(min), seconds, ok: false, note: (await failed.textContent()) ?? 'error' };
  const link = page.getByRole('link', { name: 'View on explorer' });
  await bringIntoView(page, clock, link, 'scroll to the transaction id');
  await clock.step('wait', 'broadcast transaction id on screen');
  const txid = /[0-9a-f]{64}$/.exec((await link.getAttribute('href')) ?? '')?.[0];
  const run: Run = { utc: new Date(), flow: 'swap', amount: label(min), seconds, ok: txid !== undefined };
  return txid ? { ...run, txid } : { ...run, note: 'no txid shown' };
}

async function measure(engine: Engine, path: JudgePath): Promise<boolean> {
  const { launch, options } = CONTEXTS[engine];
  const browser = await launch();
  const wallet: { child?: ChildProcess } = {};
  try {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
    await page.addInitScript(CLIPBOARD_SPY);
    const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const clock = new Clock(page, `${SHOTS}/${stamp}-${engine}-${path}`);
    let shown = '';
    if (path === 'see') shown = await see(page, clock);
    else {
      const run = await doSwap(page, clock, wallet);
      if (WRITE) appendRuns(MEASURED, [run]);
      if (!run.ok) {
        console.log(`${engine} ${path}: fail ${run.note ?? ''}`);
        return false;
      }
      shown = run.txid!;
    }
    const seconds = clock.steps.at(-1)!.at;
    for (const s of clock.steps) console.log(`  ${s.at.toFixed(1).padStart(6)} s  ${s.kind.padEnd(6)} ${s.what}`);
    const row: JudgeRow = { utc: new Date(), engine, path, seconds, ...countActions(clock.steps), commit: COMMIT };
    console.log(`${engine} ${path}: ${seconds.toFixed(1)} s, ${row.pageActions} page + ${row.walletActions} wallet actions, ${shown}`);
    if (WRITE) appendJudge(MEASURED, [row]);
    return true;
  } finally {
    wallet.child?.kill();
    await browser.close();
  }
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  let ok = true;
  for (const engine of ENGINE_LIST) for (const path of PATH_LIST) ok = (await measure(engine, path)) && ok;
  if (!ok) throw new Error('at least one path failed');
}

void main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
