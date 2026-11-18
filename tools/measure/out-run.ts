// One measured Send out (G3, KP17) without a browser: the page's own client code (core/client/out.ts runOut, its
// checks included) against the built server on this host with the crossing switched on for one asset, signed by
// the mainnet test wallet. Before the deposit is broadcast the cost card of the signed quote is saved (KC2,
// state/cost-shown/<txid>.json); then the crossing is traced until the stablecoin arrives and one Runs row is
// appended to docs/MEASURED.md (with --write). Spends stay inside state/budget.json and are recorded in the ledger.
//   npx tsx tools/measure/out-run.ts --asset ETH.USDC-0X… --source PUSD|BCH --amount 1.80 --to 0x… [--port 4186] [--quote-only] [--write]
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
import { crossingAsset, traceCrossing } from './cross.js';
import { outIntent, outLabel, overBudget } from './out-plan.js';
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
  const token = config.tokens[config.defaultToken]!;
  const source = need('--source');
  const decimals = source === 'BCH' ? 8 : token.decimals;
  const amount = parseUnits(need('--amount'), decimals);
  if (amount === undefined || amount <= 0n) throw new Error('--amount is not a valid amount of the source');
  const destination = need('--to');
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) throw new Error('--to must be a 0x address');

  const env = parseEnv(readFileSync(path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env'), 'utf8'));
  const phrase = env.get(SECRET_KEYS.bchMainnet);
  if (!phrase) throw new Error(`${SECRET_KEYS.bchMainnet} is missing from the env file`);
  const keys = hdKeysFromPhrase(phrase);
  const budget = JSON.parse(readFileSync('state/budget.json', 'utf8')) as { maxUsdPerTx: number; maxUsdPerDay: number };

  const port = Number(arg('--port') ?? '4186');
  const base = `http://127.0.0.1:${port}`;
  const server = startServer({
    port,
    dataDir: 'state/measure-data',
    patch: { compliance: { crossChainEnabled: true }, ...livePatch(config.thorchain.assets, [assetName]) },
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
    const quote = await quoteOut(api, { source, amount, symbol: entry.symbol, chain: entry.chain, destination });
    quoteUsd = Math.round(quote.usd * 100) / 100;
    const pick = {
      source, amount, decimals, asset: assetName, chain: entry.chain, symbol: entry.symbol, destination,
      category: token.category, feeCapSats: BigInt(pub.connect.feeCapSats), business: pub.business,
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
    const run = await traceCrossing(
      { flow: 'out', chain: evmChain, firstTxid: res.txid, broadcastAt, amount: label, destination, token: tokenContract },
      traceDeps(config, rpc, chain),
    );
    console.log(JSON.stringify({ ...run, utc: run.utc.toISOString() }));
    if (process.argv.includes('--write')) appendRuns('docs/MEASURED.md', [run]);
  } finally {
    await chain.close();
    server.kill();
  }
}

runCli(main);
