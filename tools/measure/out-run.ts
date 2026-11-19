// One measured Send out (G3, KP17) without a browser: the page's own client code (core/client/out.ts runOut, its
// checks included) against the built server on this host with the crossing switched on for one asset, signed by
// the mainnet test wallet. Before the deposit is broadcast the cost card of the signed quote is saved (KC2,
// state/cost-shown/<txid>.json); then the crossing is traced until the stablecoin arrives and one Runs row is
// appended to docs/MEASURED.md (with --write). Spends stay inside state/budget.json and are recorded in the ledger.
// --route near-intents measures the 1Click route instead (flow oc-out): the server offers only that asset through
// 1Click, with the env file's ONECLICK_JWT when there is one, and the crossing is traced through its status endpoint.
//   npx tsx tools/measure/out-run.ts --asset ETH.USDC-0X… --source PUSD|MUSD|BCH --amount 1.80 --to 0x… [--route near-intents] [--port 4186] [--quote-only] [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashTransaction, hexToBin } from '@bitauth/libauth';
import { makeApi } from '../../core/client/api.js';
import { quoteOut, runOut, StoppedAfterStep1 } from '../../core/client/out.js';
import { scanWallet } from '../../core/client/scan.js';
import { hdKeysFromPhrase, signWithHdKeys, type WalletSession } from '../../core/client/session.js';
import { publicConfig } from '../../core/config.js';
import { livePatch } from '../../core/route-assets.js';
import { parseUnits } from '../../core/wallet.js';
import { ElectrumChain } from '../../server/chain/electrum.js';
import { loadConfig } from '../../server/config.js';
import { SECRET_KEYS, parseEnv } from '../test-wallet/keys.js';
import { record, spentOn } from '../test-wallet/ledger.js';
import { costShown, writeCostShown } from './cost-shown.js';
import { crossingAsset, traceCrossing, type CrossDeps } from './cross.js';
import { oneClickLivePatch, outIntent, outLabel, overBudget } from './out-plan.js';
import { appendRuns } from './runs.js';
import { arg, need, runCli, traceDeps } from './run-cli.js';
import { startServer, waitHealthy } from './server.js';

const LEDGER = 'state/test-ledger.jsonl';

async function main(): Promise<void> {
  const config = loadConfig('config/sampan.json');
  const pub = publicConfig(config);
  const assetName = need('--asset');
  const entry = config.thorchain.assets.find((a) => a.asset === assetName);
  if (!entry) throw new Error(`${assetName} is not in config thorchain.assets`);
  const { chain: evmChain, token: tokenContract, rpc } = crossingAsset(config, assetName);
  const source = need('--source');
  // The token sold in step 1 (MUSD: features.musd switched on in this local server only); BCH has no step 1.
  const token = config.tokens[source === 'BCH' ? config.defaultToken : source];
  if (!token) throw new Error(`--source is BCH or one of ${Object.keys(config.tokens).join(', ')}`);
  const decimals = source === 'BCH' ? 8 : token.decimals;
  const amount = parseUnits(need('--amount'), decimals);
  if (amount === undefined || amount <= 0n) throw new Error('--amount is not a valid amount of the source');
  const destination = need('--to');
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) throw new Error('--to must be a 0x address');

  const env = parseEnv(readFileSync(path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env'), 'utf8'));
  const phrase = env.get(SECRET_KEYS.bchMainnet);
  if (!phrase) throw new Error(`${SECRET_KEYS.bchMainnet} is missing from the env file`);
  const keys = hdKeysFromPhrase(phrase);
  const routeArg = arg('--route');
  if (routeArg !== undefined && routeArg !== 'near-intents') throw new Error('--route is near-intents (absent = the active route)');
  const route = routeArg as 'near-intents' | undefined;
  const oneClickKey = env.get('ONECLICK_JWT');
  const budget = JSON.parse(readFileSync('state/budget.json', 'utf8')) as { maxUsdPerTx: number; maxUsdPerDay: number };

  const port = Number(arg('--port') ?? '4186');
  const base = `http://127.0.0.1:${port}`;
  const server = startServer({
    port,
    dataDir: 'state/measure-data',
    patch: {
      compliance: { crossChainEnabled: true },
      ...(source === 'MUSD' ? { features: { musd: true } } : {}),
      ...(route ? oneClickLivePatch(config.oneClick.assets, entry.chain, entry.symbol, 'out') : livePatch(config.thorchain.assets, [assetName])),
    },
    ...(route && oneClickKey ? { env: { ONECLICK_JWT: oneClickKey } } : {}),
  });
  const chain = new ElectrumChain(config.electrum.servers);
  try {
    await waitHealthy(base);
    const api = makeApi((p, init) => fetch(`${base}${p}`, init));
    let spentUsd = 0;
    let quoteUsd = 0;
    let depositPrompt = '';
    let firstSignedAt: Date | undefined;
    let onDepositSigned: (signed: string) => void = () => undefined;
    const session: WalletSession = {
      name: 'Sampan test wallet',
      publicKey: (p, i) => keys.publicKey(p, i),
      sign: async (request) => {
        // runOut has already run checkTransaction on this exact transaction against what the quote showed.
        const signed = signWithHdKeys(keys, request);
        firstSignedAt ??= new Date();
        const usd = spentUsd === 0 ? quoteUsd : 0;
        spentUsd += usd;
        if (request.userPrompt === depositPrompt) onDepositSigned(signed);
        record(LEDGER, { utc: new Date().toISOString(), usd, prompt: request.userPrompt });
        return signed;
      },
    };
    const wallet = await scanWallet(api, session, 'bitcoincash', { gapLimit: pub.connect.gapLimit, maxRounds: config.connect.maxScanRounds });
    const quote = await quoteOut(api, { source, amount, symbol: entry.symbol, chain: entry.chain, destination, ...(route ? { route } : {}) });
    quoteUsd = Math.round(quote.usd * 100) / 100;
    const pick = {
      source, amount, decimals, asset: assetName, chain: entry.chain, symbol: entry.symbol, destination,
      category: token.category, feeCapSats: BigInt(pub.connect.feeCapSats), business: pub.business,
      ...(route ? { route } : {}),
    };
    const intent = outIntent(pick, quote);
    depositPrompt = intent.prompts.deposit;
    const label = outLabel(pick, quote);
    console.log(JSON.stringify({ label, usd: quoteUsd, memo: quote.memo, vault: quote.vault, expectedOut: quote.expectedOut, minOut: quote.minOut, fees: quote.fees }));
    writeFileSync('state/out-quote.json', JSON.stringify({ quote }));
    if (process.argv.includes('--quote-only')) return;
    const refused = overBudget(quoteUsd, spentOn(LEDGER, new Date().toISOString().slice(0, 10)), budget);
    if (refused) throw new Error(`budget: ${refused}`);

    onDepositSigned = (signed) => {
      const txid = hashTransaction(hexToBin(signed));
      console.log(`cost card saved: ${writeCostShown('state/cost-shown', costShown(pub, 'out', quote, txid, evmChain, new Date()))}`);
    };
    let res: Awaited<ReturnType<typeof runOut>>;
    try {
      const from = arg('--from');
      res = await runOut({ api, session, wallet, intent, ...(from ? { fromTxid: from } : {}), onStep: (s) => console.log(`step ${s.step}: ${s.phase}`) });
    } catch (e) {
      if (e instanceof StoppedAfterStep1) {
        console.error(`stopped after step 1 (swap ${e.swapTxid}); resume with --from ${e.swapTxid}`);
        console.error(e.reason instanceof Error ? e.reason.message : e.reason);
      }
      throw e;
    }
    // Seconds run from the first signature (step 1 for a stablecoin source) until the stablecoin arrives.
    const broadcastAt = firstSignedAt ?? new Date();
    console.log(JSON.stringify({ crossing: res.crossingId, swap: res.swapTxid, deposit: res.txid }));
    const deps = traceDeps(config, rpc, chain);
    const run = await traceCrossing(
      { flow: route ? 'oc-out' : 'out', chain: evmChain, firstTxid: res.txid, broadcastAt, amount: label, destination, token: tokenContract },
      route ? { ...deps, status: crossingStatus(api, res.crossingId, evmChain) } : deps,
    );
    console.log(JSON.stringify({ ...run, utc: run.utc.toISOString() }));
    if (process.argv.includes('--write')) appendRuns('docs/MEASURED.md', [run]);
  } finally {
    await chain.close();
    server.kill();
  }
}

/**
 * 1Click names a crossing by its deposit address, which the server keeps on the crossing row: ask the page's own status
 * endpoint. 1Click does not name the chain of the transaction it sent; it is the asset's chain, and the tracer still
 * reads that transaction's receipt there and checks it pays the destination.
 */
function crossingStatus(api: ReturnType<typeof makeApi>, crossingId: string, evmChain: string): CrossDeps['status'] {
  return async () => {
    const v = await api.get<{ out: { stage: string; outTxid: string | null } | null }>(`/api/crossings/${crossingId}`);
    const stage = v.out?.stage;
    if (stage !== 'unseen' && stage !== 'pending' && stage !== 'done' && stage !== 'refunded' && stage !== 'failed') throw new Error('no answer');
    return { stage, ...(v.out?.outTxid ? { outTxid: v.out.outTxid, outChain: evmChain } : {}) };
  };
}

runCli(main);
