// Measured giveBack on mainnet (G2, KP3 flow "giveBack"): BCH at a landing address whose minimum rate the pools
// can never meet goes back to the owner once the coin is old enough.
//   npx tsx tools/measure/give-back.ts --open --bch 0.003 --usd 0.60   make the card, pay it from the test wallet
//   npx tsx tools/measure/give-back.ts --finish                         run the public finisher on the card
// --open writes a recovery card for receive/<--owner> of the test wallet with a minimum rate far above any pool
// (`IMPOSSIBLE_FACTOR` times today's), pays it with tools/test-wallet/send.ts and keeps the card and payment time
// in state/. --finish runs scripts/finisher.ts on that card in its automatic mode, so conversion is tried first and
// refused; once the coin is `returnAfter` blocks old the BCH goes back. The row is ok only when the returned output
// is found at the owner's address. `seconds` runs from the payment to the return, block wait included.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hdKeysFromPhrase } from '../../core/client/session.js';
import { makeCard, paramsOf, type LandingCard } from '../../core/landing-card.js';
import { LANDING_RATE_DEN } from '../../core/landing.js';
import { deriveAddress, parseUnits } from '../../core/wallet.js';
import { ElectrumChain } from '../../server/chain/electrum.js';
import { loadConfig } from '../../server/config.js';
import { SECRET_KEYS, parseEnv } from '../test-wallet/keys.js';
import { appendRuns, type Run } from './runs.js';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const STATE = 'state/give-back.json';
const MEASURED = 'docs/MEASURED.md';
/** Tokens per BCH the card demands, as a multiple of what the pools pay today (0.001 BCH ~ 0.20 PUSD). */
const IMPOSSIBLE_FACTOR = 1000n;
const TODAY_UNITS_PER_BCH = 20_000n;

interface Saved {
  card: LandingCard;
  bch: string;
  paidAt: string;
}

const config = loadConfig('config/sampan.json');
const token = config.tokens[config.defaultToken]!;

const run = (args: string[]): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.on('exit', (code) => resolve({ code, out }));
  });

async function open(): Promise<void> {
  if (existsSync(STATE)) throw new Error(`${STATE} exists: finish that landing first`);
  const bch = arg('--bch', '0.003');
  const usd = arg('--usd', '');
  if (!(Number(usd) > 0) || parseUnits(bch, 8) === undefined) throw new Error('usage: give-back.ts --open --bch <bch> --usd <value>');
  const env = parseEnv(readFileSync(path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env'), 'utf8'));
  const phrase = env.get(SECRET_KEYS.bchMainnet);
  if (!phrase) throw new Error(`${SECRET_KEYS.bchMainnet} is missing from the env file`);
  const i = Number(arg('--owner', '8'));
  const owner = deriveAddress(hdKeysFromPhrase(phrase).publicKey('receive', i), 'receive', i, 'bitcoincash');
  const params = {
    ownerLockHex: owner.lockingHex,
    category: token.category.toLowerCase(),
    rateNum: TODAY_UNITS_PER_BCH * IMPOSSIBLE_FACTOR,
    rateDen: LANDING_RATE_DEN,
    returnAfter: config.landing.returnAfterBlocks,
  };
  const card = makeCard(params, { network: 'mainnet', token: token.symbol, created: new Date() });
  writeFileSync('state/give-back-card.json', JSON.stringify(card, null, 2));
  const sent = await run(['tools/test-wallet/send.ts', card.address, bch, '--usd', usd, '--why', `Pay ${bch} BCH to a landing address that can only give back`]);
  if (sent.code !== 0) throw new Error('the payment was not sent');
  const saved: Saved = { card, bch, paidAt: new Date().toISOString() };
  writeFileSync(STATE, JSON.stringify(saved, null, 2));
  console.log(`paid ${card.address}; finish after ${params.returnAfter} blocks`);
}

async function finish(): Promise<void> {
  const saved = JSON.parse(readFileSync(STATE, 'utf8')) as Saved;
  const res = await run(['scripts/finisher.ts', 'state/give-back-card.json']);
  const txid = /: returned, txid ([0-9a-f]{64})/.exec(res.out)?.[1];
  if (!txid) {
    console.log('not returned yet; nothing recorded');
    return;
  }
  const seconds = (Date.now() - Date.parse(saved.paidAt)) / 1000;
  const chain = new ElectrumChain(config.electrum.servers);
  let back: bigint | undefined;
  try {
    for (let i = 0; i < 10 && back === undefined; i++) {
      back = (await chain.listUnspent(saved.card.ownerLockHex)).find((u) => u.txid === txid && u.vout === 0 && !u.token)?.sats;
      if (back === undefined) await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    await chain.close();
  }
  const params = paramsOf(saved.card);
  const amount = `${saved.bch} BCH back to the owner as ${back === undefined ? '?' : `${back} sats`} (minimum rate out of reach, after ${params.returnAfter} blocks)`;
  const row: Run = { utc: new Date(), flow: 'giveBack', amount, txid, seconds, ok: back !== undefined };
  appendRuns(MEASURED, [back === undefined ? { ...row, note: 'returned output not found at the owner address' } : row]);
  renameSync(STATE, `state/give-back-${txid.slice(0, 8)}.json`);
  console.log(`giveBack: ${row.ok ? 'ok' : 'fail'} ${txid}`);
}

void (process.argv.includes('--finish') ? finish() : process.argv.includes('--open') ? open() : Promise.reject(new Error('pass --open or --finish'))).then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
