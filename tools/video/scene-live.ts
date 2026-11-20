// Scenes recorded on the live site: the front page, the proof table on /how, one swap signed by the headless test
// wallet through the page's WizardConnect link, and one landing address paid with a plain BCH payment. The swap and
// the landing are real mainnet transactions inside state/budget.json; each returns its Runs row for docs/MEASURED.md.
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { formatUnits, parseUnits } from '../../core/wallet.js';
import type { ElectrumChain } from '../../server/chain/electrum.js';
import type { SampanConfig } from '../../core/config.js';
import { openAddress, shownLanding, tokensAtOwner, waitFinished } from '../measure/land-page.js';
import type { Run } from '../measure/runs.js';
import { txidsFromLinks } from './shots.js';
import type { Take } from './take.js';

export interface SceneValue {
  txids: string[];
  receipt?: string;
  run?: Run;
}

export interface LiveDeps {
  base: string;
  config: SampanConfig;
  en: Record<string, string>;
  intentFile: string;
}

const SWAP_TIMEOUT_MS = 180_000;
const FINISH_TIMEOUT_MS = 15 * 60_000;

async function quoteUsd(d: LiveDeps, sats: bigint): Promise<number> {
  const token = d.config.tokens[d.config.defaultToken]!;
  const res = await fetch(`${d.base}/api/swap/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: d.base },
    body: JSON.stringify({ token: token.symbol, side: 'buy', amount: sats.toString() }),
  });
  const body = (await res.json()) as { quote?: { usd: number } };
  if (!body.quote) throw new Error(`quote failed: ${JSON.stringify(body)}`);
  return Math.round(body.quote.usd * 100) / 100;
}

export async function front(t: Take, d: LiveDeps): Promise<SceneValue> {
  await t.page.goto(d.base, { waitUntil: 'load' });
  await t.page.locator('.button--primary').first().waitFor();
  t.mark('front page loaded');
  await t.page.locator('.swap__receive').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  await t.dwell(7000);
  t.mark('price refreshed by itself');
  await t.glide('.measured');
  t.mark('Measured card');
  await t.dwell(5000);
  return { txids: [] };
}

export async function how(t: Take, d: LiveDeps): Promise<SceneValue> {
  await t.page.goto(`${d.base}/how`, { waitUntil: 'load' });
  t.mark('/how loaded');
  await t.dwell(3000);
  await t.glide('#proof');
  t.mark('proof table');
  await t.dwell(4000);
  const rows = t.page.locator('#proof a[href]');
  const hrefs = await rows.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  await t.drift(600);
  await t.dwell(4000);
  t.mark('more rows');
  return { txids: txidsFromLinks(hrefs) };
}

export async function swap(t: Take, d: LiveDeps): Promise<SceneValue> {
  const token = d.config.tokens[d.config.defaultToken]!;
  const amount = parseUnits(d.config.limits.judgeSwapBch, 8)!;
  const { page } = t;
  let wallet: ChildProcess | undefined;
  try {
    await page.goto(d.base, { waitUntil: 'load' });
    t.mark('front page');
    await t.dwell(1500);
    await page.locator('.button--primary').first().click();
    await page.getByRole('button', { name: d.en['wallet.copyLink']! }).click();
    t.mark('Copy link: the pairing link for the wallet');
    const uri = String(await page.evaluate('window.__copied || ""'));
    if (!uri.startsWith('wiz')) throw new Error('no pairing link on the page');
    writeFileSync(d.intentFile, '{}');
    wallet = spawn(process.execPath, ['--import', 'tsx', 'tools/test-wallet/connect.ts', uri, d.intentFile, '--timeout-seconds', '300', '--signatures', '1'], { stdio: ['ignore', 'inherit', 'inherit'] });
    await page.locator('.swap__wallet').filter({ hasText: 'In your wallet' }).waitFor({ timeout: 90_000 });
    t.mark('wallet connected, balance shown');
    const box = page.getByRole('textbox').first();
    if ((await box.inputValue()) !== d.config.limits.judgeSwapBch) await box.fill(d.config.limits.judgeSwapBch);
    const pattern = new RegExp(`at least ([0-9.]+) ${token.symbol}\\.`);
    await page.locator('.swap__receive').filter({ hasText: pattern }).waitFor({ timeout: 60_000 });
    t.mark('quote shown');
    await t.dwell(3000);
    const min = parseUnits(pattern.exec((await page.locator('.swap__receive').textContent()) ?? '')![1]!, token.decimals)!;
    writeFileSync(d.intentFile, JSON.stringify({ spend: { sats: amount.toString() }, receive: { category: token.category.toLowerCase(), min: min.toString() }, usd: await quoteUsd(d, amount) }));
    const started = Date.now();
    await page.locator('.button--primary').first().click();
    t.mark('Swap pressed, the wallet signs once');
    const done = page.locator('.swap__done');
    await done.or(page.locator('.swap__error')).first().waitFor({ timeout: SWAP_TIMEOUT_MS });
    const seconds = (Date.now() - started) / 1000;
    const amountLabel = `${formatUnits(amount, 8)} BCH to at least ${formatUnits(min, token.decimals)} ${token.symbol} · demo video`;
    if (!(await done.isVisible())) return { txids: [], run: { utc: new Date(), flow: 'swap', amount: amountLabel, seconds, ok: false, note: (await page.locator('.swap__error').textContent()) ?? 'error' } };
    const link = page.getByRole('link', { name: 'View on explorer' });
    await link.scrollIntoViewIfNeeded();
    t.mark('swap sent, transaction id on screen');
    await t.dwell(5000);
    const txid = txidsFromLinks([(await link.getAttribute('href')) ?? ''])[0];
    const run: Run = { utc: new Date(), flow: 'swap', amount: amountLabel, seconds, ok: txid !== undefined, ...(txid ? { txid } : { note: 'no txid shown' }) };
    return { txids: txid ? [txid] : [], run };
  } finally {
    wallet?.kill();
  }
}

export async function land(t: Take, d: LiveDeps & { chain: ElectrumChain; owner: { tokenAddress: string; lockingHex: string }; payBch: string }): Promise<SceneValue> {
  const token = d.config.tokens[d.config.defaultToken]!;
  const { page } = t;
  await page.goto(d.base, { waitUntil: 'load' });
  await page.getByRole('tab', { name: d.en['tabs.in']! }).click();
  t.mark('Bring in tab: a landing address for any BCH wallet');
  await t.dwell(2000);
  await page.locator('.field__input--address').pressSequentially(d.owner.tokenAddress, { delay: 15 });
  await page.locator('.field__input--address').press('Enter');
  await openAddress(page, d.en['land.open']!);
  const shown = await shownLanding(page, d.base, d.en['land.follow']!);
  if (shown.ownerLock !== d.owner.lockingHex) throw new Error('the card pays someone else');
  t.mark('landing address and QR shown');
  await t.dwell(4000);
  const sats = parseUnits(d.payBch, 8)!;
  const usd = await quoteUsd(d, sats);
  const send = spawn(process.execPath, ['--import', 'tsx', 'tools/test-wallet/send.ts', shown.address, d.payBch, '--usd', String(usd), '--why', `Pay ${d.payBch} BCH to a landing address (demo video)`], { stdio: ['ignore', 'inherit', 'inherit'] });
  const code = await new Promise<number | null>((r) => send.on('exit', r));
  const label = (tokens?: bigint) => `${d.payBch} BCH to ${tokens === undefined ? '?' : formatUnits(tokens, token.decimals, token.decimals)} ${token.symbol} (plain payment, demo video)`;
  if (code !== 0) return { txids: [], run: { utc: new Date(), flow: 'land', amount: label(), ok: false, note: 'the payment was not sent' } };
  const paidAt = Date.now();
  t.mark('plain BCH payment sent from another wallet');
  const done = await waitFinished(d.base, shown, FINISH_TIMEOUT_MS);
  const seconds = (Date.now() - paidAt) / 1000;
  t.mark(`server reports ${done.status}`);
  // The page polls the landing on its own (landing.pagePollSeconds): the scene ends once its ferry has arrived.
  await page.locator('.ferry[data-arrive="done"]').first().waitFor({ timeout: 60_000 }).catch(() => undefined);
  t.mark('arrived on the page');
  await t.dwell(4000);
  const receipt = `/c/${shown.crossingId}`;
  if (done.status !== 'converted' || !done.txid) return { txids: [], receipt, run: { utc: new Date(), flow: 'land', amount: label(), seconds, ok: false, note: `server status ${done.status}` } };
  const tokens = await tokensAtOwner(d.chain, token.category.toLowerCase(), shown.ownerLock, done.txid);
  const run: Run = { utc: new Date(), flow: 'land', amount: label(tokens), txid: done.txid, seconds, ok: tokens !== undefined, ...(tokens === undefined ? { note: 'tokens not found at the owner address' } : {}) };
  return { txids: [done.txid], receipt, run };
}
