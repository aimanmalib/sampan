// docs/route-facts.json (K6P5): for every live route, the measured time (ok Runs rows of docs/MEASURED.md), the
// signatures counted by e2e/route-signatures.spec.ts, and the fee at USD 2, 20 and 100 quoted now by the built server
// on this host (the same quote modules and cost card as the page). No transaction is made and nothing is spent: only
// quotes. A quote that fails is kept as null with the server's reason.
//   ROUTE_SIGNATURES_OUT=state/route-facts/signatures.json npx playwright test e2e/route-signatures.spec.ts --project=chromium-desktop
//   npx tsx tools/measure/route-facts.ts [--signatures state/route-facts/signatures.json] [--port 4189] [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeApi, type Api } from '../../core/client/api.js';
import { inCard, outCard } from '../../core/client/cost.js';
import { quoteIn } from '../../core/client/in.js';
import { quoteOut } from '../../core/client/out.js';
import { quoteSwap } from '../../core/client/swap.js';
import { publicConfig, type PublicConfig } from '../../core/config.js';
import type { Gas } from '../../core/cost.js';
import { parseRuns } from '../../core/proof.js';
import { buildFacts, FEE_AMOUNTS, feeOf, liveRoutes, tradeParts, type Fee, type FeeAmount, type FeePart, type LiveRoute, type SignatureCounts } from '../../core/route-facts.js';
import { loadConfig } from '../../server/config.js';
import { parseEnv } from '../test-wallet/keys.js';
import { arg, runCli } from './run-cli.js';
import { startServer, waitHealthy } from './server.js';

export const FACTS_FILE = 'docs/route-facts.json';
/** Addresses only quoted against, never paid: the test wallet's public BCH address and an EVM address of the team. */
const BCH_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const EVM_ADDRESS = '0x1a877169bB03400fA69EC4813889E78994D194Cb';

type Quoter = (usd: number) => Promise<{ parts: FeePart[]; payUsd: number; network: 'included' | 'excluded' }>;

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);

async function gasPrice(rpc: readonly string[]): Promise<bigint | null> {
  for (const url of rpc) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }) });
      const j = (await res.json()) as { result?: string };
      if (j.result && /^0x[0-9a-f]+$/i.test(j.result)) return BigInt(j.result);
    } catch {
      // next endpoint
    }
  }
  return null;
}

function quoterFor(r: LiveRoute, pub: PublicConfig, api: Api, usdPerSat: number): Quoter {
  const token = pub.tokens[pub.defaultToken]!;
  if (r.flow === 'swap' || r.flow === 'land') {
    return async (usd) => {
      const supply = BigInt(Math.round(usd / usdPerSat));
      const q = await quoteSwap(api, { token: pub.defaultToken, side: 'buy', amount: supply });
      const at = q.usd / Number(supply);
      // A landing converts in the contract: its fee is the landing's convert fee, and the payer's own payment fee is
      // their wallet's, left out as the page leaves it out.
      const networkSats = r.flow === 'land' ? BigInt(pub.landing.convertFeeSats) : BigInt(q.networkSats ?? '0');
      const parts = tradeParts({ usdPerSat: at, payUsd: usd, poolFeeSats: BigInt(q.poolFeeSats ?? '0'), sampanFeeSats: BigInt(q.sampanFeeSats), networkSats, impactBps: q.impactBps ?? 0 });
      return { parts, payUsd: usd, network: r.flow === 'land' ? 'excluded' : 'included' };
    };
  }
  const symbol = r.symbols[0]!;
  const chain = pub.evm.chains.find((c) => c.key === r.chain)!;
  const route = r.route === 'near-intents' ? { route: 'near-intents' as const } : {};
  if (r.flow === 'out') {
    return async (usd) => {
      const amount = BigInt(Math.round(usd * 10 ** token.decimals));
      const q = await quoteOut(api, { source: pub.defaultToken, amount, symbol, chain: chain.key, destination: EVM_ADDRESS, ...route });
      const card = outCard(pub, q, pub.defaultToken, amount, []);
      if (!card) throw new Error('the route named no fee parts');
      return { parts: card.parts, payUsd: Number(card.payUsd) / 1e6, network: 'included' };
    };
  }
  return async (usd) => {
    const amount = BigInt(Math.round(usd * 1e8));
    const q = await quoteIn(api, { symbol, chain: chain.key, amount, receive: pub.defaultToken, address: BCH_ADDRESS, ...route });
    // THORChain: an approval and a router deposit, priced as the page prices them. 1Click: one plain transfer, and the
    // page's card says "plus gas" instead of an estimate, so the gas stays out here as well.
    let gas: Gas | undefined;
    if (r.route === 'thorchain') {
      const wei = await gasPrice(chain.rpc);
      if (wei === null || !q.gasAssetUsdE8) throw new Error(`no gas price for ${chain.key}`);
      gas = { approve: true, approveUnits: BigInt(chain.gas.approve), depositUnits: BigInt(chain.gas.deposit), priceWei: wei, nativeUsdE8: BigInt(q.gasAssetUsdE8) };
    }
    const card = inCard(pub, q, chain, true, gas, []);
    if (!card) throw new Error('the route named no fee parts');
    return { parts: card.parts, payUsd: Number(card.payUsd) / 1e6, network: gas ? 'included' : 'excluded' };
  };
}

async function feesFor(quote: Quoter): Promise<Record<FeeAmount, Fee>> {
  const fees = {} as Record<FeeAmount, Fee>;
  for (const amount of FEE_AMOUNTS) {
    try {
      const q = await quote(Number(amount));
      fees[amount] = feeOf(q.parts, q.payUsd, new Date().toISOString(), q.network);
    } catch (e) {
      fees[amount] = { usd: null, reason: reasonOf(e) };
    }
  }
  return fees;
}

async function main(): Promise<void> {
  const config = loadConfig('config/sampan.json');
  const pub = publicConfig(config);
  const routes = liveRoutes(config);
  const signatures = JSON.parse(readFileSync(arg('--signatures') ?? 'state/route-facts/signatures.json', 'utf8')) as { counted_at: string; counts: Partial<SignatureCounts> };
  const runs = parseRuns(readFileSync('docs/MEASURED.md', 'utf8'));

  // The 1Click key, when the env file has one, goes to the local server's env only, as on the live site.
  const envFile = path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env');
  let oneClickKey: string | undefined;
  try {
    oneClickKey = parseEnv(readFileSync(envFile, 'utf8')).get('ONECLICK_JWT');
  } catch {
    oneClickKey = undefined;
  }
  const port = Number(arg('--port') ?? '4189');
  const base = `http://127.0.0.1:${port}`;
  const server = startServer({ port, dataDir: 'state/measure-data', patch: {}, ...(oneClickKey ? { env: { ONECLICK_JWT: oneClickKey } } : {}) });
  try {
    await waitHealthy(base);
    const api = makeApi((p, init) => fetch(`${base}${p}`, init));
    const probe = await quoteSwap(api, { token: pub.defaultToken, side: 'buy', amount: 100_000n });
    const usdPerSat = probe.usd / 100_000;
    const fees: Record<string, Record<FeeAmount, Fee>> = {};
    for (const r of routes) {
      fees[r.id] = await feesFor(quoterFor(r, pub, api, usdPerSat));
      console.log(`${r.id} ${JSON.stringify(fees[r.id])}`);
    }
    const facts = buildFacts({ routes, runs, signatures, fees, now: new Date() });
    const json = `${JSON.stringify(facts, null, 2)}\n`;
    if (process.argv.includes('--write')) writeFileSync(FACTS_FILE, json);
    else process.stdout.write(json);
  } finally {
    server.kill();
  }
}

runCli(main);
