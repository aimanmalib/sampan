// One measured Bring in (G3a, G4, KP17) without a browser: the page's own client code (core/client/in.ts runIn, its
// plan checks included: memo destination and limit, the landing address recomputed from its card) against the built
// server on this host with the crossing switched on for one asset, the EVM side signed by the EVM test key through a
// local EIP-1193 provider. With --receive PUSD (or MUSD: features.musd switched on in this local server only) the route pays a landing address and the server's finisher converts it
// (flow g3a with --g3a, else in); with --receive BCH the route pays the owner directly (flow in). The crossing is traced
// until the BCH (and, for a landing, the conversion) is seen, and one Runs row is appended with --write.
// --route near-intents measures the 1Click route instead (flow oc-in): the server offers only that asset through 1Click,
// with the env file's ONECLICK_JWT when there is one; the token goes to a one-time deposit address in one transfer and
// the crossing is traced through the page's status endpoint.
//   npx tsx tools/measure/in-run.ts --asset ETH.USDC-0X… --amount 2 --receive PUSD|MUSD|BCH [--route near-intents] [--owner 14] [--g3a] [--port 4187] [--quote-only] [--write]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Hex } from 'viem';
import { parseAddress } from '../../core/address.js';
import { makeApi } from '../../core/client/api.js';
import { quoteIn, runIn } from '../../core/client/in.js';
import { hdKeysFromPhrase } from '../../core/client/session.js';
import { publicConfig } from '../../core/config.js';
import { livePatch } from '../../core/route-assets.js';
import { deriveAddress, parseUnits } from '../../core/wallet.js';
import { ElectrumChain } from '../../server/chain/electrum.js';
import { loadConfig } from '../../server/config.js';
import { SECRET_KEYS, parseEnv } from '../test-wallet/keys.js';
import { record, spentOn } from '../test-wallet/ledger.js';
import { crossingAsset, traceCrossing } from './cross.js';
import { jsonRpcOver, keyProvider } from './evm-key-provider.js';
import { convertedTxid, inLabel, type LandingView } from './in-plan.js';
import { oneClickLivePatch, overBudget } from './out-plan.js';
import { appendRuns } from './runs.js';
import { arg, crossingStatus, need, runCli, traceDeps } from './run-cli.js';
import { startServer, waitHealthy } from './server.js';

const LEDGER = 'state/test-ledger.jsonl';

async function main(): Promise<void> {
  const config = loadConfig('config/sampan.json');
  const pub = publicConfig(config);
  const assetName = need('--asset');
  const entry = config.thorchain.assets.find((a) => a.asset === assetName);
  if (!entry) throw new Error(`${assetName} is not in config thorchain.assets`);
  const { chain: evmKey, rpc } = crossingAsset(config, assetName);
  const evm = config.evm.chains.find((c) => c.key === evmKey)!;
  const tokenEntry = evm.tokens[entry.symbol]!;
  const receive = need('--receive');
  const landing = receive !== 'BCH';
  const token = config.tokens[receive];
  if (landing && !token) throw new Error(`--receive is BCH or one of ${Object.keys(config.tokens).join(', ')}`);
  const amount = parseUnits(need('--amount'), 8);
  if (amount === undefined || amount <= 0n) throw new Error('--amount is not a valid amount of the stablecoin');

  const env = parseEnv(readFileSync(path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env'), 'utf8'));
  const phrase = env.get(SECRET_KEYS.bchMainnet);
  const key = env.get(SECRET_KEYS.evm);
  if (!phrase || !key) throw new Error('the env file needs the mainnet phrase and the EVM test key');
  const routeArg = arg('--route');
  if (routeArg !== undefined && routeArg !== 'near-intents') throw new Error('--route is near-intents (absent = the active route)');
  const route = routeArg as 'near-intents' | undefined;
  const oneClickKey = env.get('ONECLICK_JWT');
  const ownerIndex = Number(arg('--owner') ?? '14');
  const owner = deriveAddress(hdKeysFromPhrase(phrase).publicKey('receive', ownerIndex), 'receive', ownerIndex, 'bitcoincash');
  const budget = JSON.parse(readFileSync('state/budget.json', 'utf8')) as { maxUsdPerTx: number; maxUsdPerDay: number };
  const provider = keyProvider({ key: key as Hex, chain: evm, rpc: jsonRpcOver(evm.rpc) });

  const port = Number(arg('--port') ?? '4187');
  const base = `http://127.0.0.1:${port}`;
  const server = startServer({
    port,
    dataDir: 'state/measure-data',
    patch: {
      compliance: { crossChainEnabled: true },
      ...(route ? { oneClick: oneClickLivePatch(config.oneClick.assets, entry.chain, entry.symbol, 'in').oneClick } : livePatch(config.thorchain.assets, [assetName])),
      features: { landing: true, ...(route ? { oneClick: true } : {}), ...(receive === 'MUSD' ? { musd: true } : {}) },
      ops: { testAddresses: [owner.address] },
    },
    ...(route && oneClickKey ? { env: { ONECLICK_JWT: oneClickKey } } : {}),
  });
  const chain = new ElectrumChain(config.electrum.servers);
  try {
    await waitHealthy(base);
    const api = makeApi((p, init) => fetch(`${base}${p}`, init));
    const quote = await quoteIn(api, { symbol: entry.symbol, chain: entry.chain, amount, receive, address: owner.address, ...(route ? { route } : {}) });
    const usd = Math.round(quote.usd * 100) / 100;
    const label = inLabel({ amount, symbol: entry.symbol, chain: entry.chain, receive, landing }, BigInt(quote.minSats));
    console.log(JSON.stringify({ label, usd, owner: `receive/${ownerIndex}`, from: provider.address, expectedSats: quote.expectedSats, minSats: quote.minSats, fees: quote.fees, seconds: quote.seconds }));
    if (process.argv.includes('--quote-only')) return;
    const refused = overBudget(usd, spentOn(LEDGER, new Date().toISOString().slice(0, 10)), budget);
    if (refused) throw new Error(`budget: ${refused}`);

    let broadcastAt = new Date();
    const res = await runIn({
      api,
      provider,
      from: provider.address,
      intent: {
        symbol: entry.symbol,
        chain: evm,
        token: tokenEntry.address,
        decimals: tokenEntry.decimals,
        amount,
        receive,
        address: owner.address,
        minSats: BigInt(quote.minSats),
        ...(route ? { route } : {}),
        ...(landing ? { landing: { category: token!.category, returnAfter: config.landing.returnAfterBlocks, prefix: 'bitcoincash' as const } } : {}),
      },
      timing: { pollMs: pub.evm.receiptPollSeconds * 1000, waitMs: pub.evm.receiptWaitSeconds * 1000, replanMs: pub.evm.replanSeconds * 1000 },
      onStep: (s) => {
        if (s === 'deposit') broadcastAt = new Date();
        console.log(`step ${s}`);
      },
    });
    record(LEDGER, { utc: new Date().toISOString(), usd, prompt: `Bring in ${label} (measured run)` });
    console.log(JSON.stringify(res));

    const view = async (id: string) => (await fetch(`${base}/api/crossings/${id}`).then((r) => r.json())) as LandingView;
    let destination = owner.lockingHex;
    if (res.landingId) {
      const address = (await view(res.landingId)).landing?.address ?? '';
      const parsed = parseAddress(address, 'bitcoincash');
      if (typeof parsed === 'string') throw new Error(`the landing crossing names no address: ${parsed}`);
      destination = parsed.lockingHex;
      console.log(`landing address ${address}`);
    }
    const landingId = res.landingId;
    const run = await traceCrossing(
      { flow: route ? 'oc-in' : landing && process.argv.includes('--g3a') ? 'g3a' : 'in', chain: evmKey, firstTxid: res.hash, broadcastAt, amount: label, destination },
      {
        ...traceDeps(config, rpc, chain),
        ...(route ? { status: crossingStatus((p) => api.get(p), res.crossingId, 'BCH') } : {}),
        ...(landingId ? { convert: async (bchTxid: string) => convertedTxid(await view(landingId), bchTxid) } : {}),
      },
    );
    console.log(JSON.stringify({ ...run, utc: run.utc.toISOString() }));
    if (process.argv.includes('--write')) appendRuns('docs/MEASURED.md', [run]);
  } finally {
    await chain.close();
    server.kill();
  }
}

runCli(main);
