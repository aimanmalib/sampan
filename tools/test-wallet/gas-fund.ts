// One gas funding swap for the EVM test key (KMR5): BCH from the mainnet test wallet to a chain's gas coin through
// THORChain (e.g. ETH.ETH), so the key can pay for approve + router deposit when Bring in is measured. Not a
// measured crossing: it is recorded in the ledger only, never as an `out` Runs row.
//   npx tsx tools/test-wallet/gas-fund.ts --asset ETH.ETH --sats 450000 --max-usd 1.5 [--quote-only]
// The memo is checked to name the asset, the test key's address and at least the quoted minimum; the deposit passes
// checkTransaction (THORChain rule 6) and the VM before it is broadcast. The value in USD is read from THORChain's
// own pool price of the gas coin; above --max-usd or the test budget nothing is sent.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAddress } from '../../core/address.js';
import { checkTransaction } from '../../core/check.js';
import { hdKeysFromPhrase, signWithHdKeys } from '../../core/client/session.js';
import { evmAddress } from '../../core/keys.js';
import { memoMatches, opReturnHex } from '../../core/routes/memo.js';
import { verifyTransaction } from '../../core/tx/verify.js';
import { outputToWire, txFromHex, txToHex } from '../../core/wire.js';
import { ElectrumChain } from '../../server/chain/electrum.js';
import { loadConfig } from '../../server/config.js';
import { ThorchainRoute } from '../../server/routes/thorchain.js';
import { Thornode } from '../../server/routes/thornode.js';
import { overBudget } from '../measure/out-plan.js';
import { testWalletCoins } from './coins.js';
import { SECRET_KEYS, parseEnv } from './keys.js';
import { record, spentOn } from './ledger.js';
import type { Budget } from './policy.js';

/** USD value of a gas coin amount in THORChain units (1e8) at THORChain's pool price (USD, 1e8), cents rounded up. */
export function gasUsd(units: bigint, priceE8: bigint): number {
  const cents = (units * priceE8 + 10n ** 14n - 1n) / 10n ** 14n;
  return Number(cents) / 100;
}

/** Why the funding swap may not be sent, or undefined when it may. */
export function refuseFunding(usd: number, maxUsd: number, budget: Budget, spentTodayUsd: number): string | undefined {
  if (usd > maxUsd) return `USD ${usd} is above the gas funding cap ${maxUsd}`;
  return overBudget(usd, spentTodayUsd, budget) ?? undefined;
}

const LEDGER = 'state/test-ledger.jsonl';

async function main(): Promise<void> {
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const asset = arg('--asset') ?? '';
  const sats = BigInt(arg('--sats') ?? '0');
  const maxUsd = Number(arg('--max-usd'));
  if (!/^[A-Z]+\.[A-Z]+$/.test(asset) || sats <= 0n || !(maxUsd > 0)) throw new Error('usage: gas-fund.ts --asset <CHAIN.COIN> --sats <n> --max-usd <usd>');
  const [chainKey, coin] = asset.split('.') as [string, string];
  const config = loadConfig('config/sampan.json');
  const env = parseEnv(readFileSync(path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env'), 'utf8'));
  const phrase = env.get(SECRET_KEYS.bchMainnet);
  const evmKey = env.get(SECRET_KEYS.evm);
  if (!phrase || !evmKey) throw new Error('the env file needs the mainnet phrase and the EVM test key');
  const keys = hdKeysFromPhrase(phrase);
  const destination = evmAddress(evmKey);
  const budget = JSON.parse(readFileSync('state/budget.json', 'utf8')) as Budget;

  const route = new ThorchainRoute({
    node: new Thornode(config.thorchain.nodes, undefined, config.thorchain.timeoutMs),
    slippageBps: config.thorchain.slippageBps,
    minSatsPerByte: BigInt(config.fees.satsPerByte),
  });
  const quote = await route.quoteOut({ sats, asset, destination });
  const price = await route.gasAssetUsd(chainKey, coin);
  if (price === null) throw new Error(`THORChain has no ${asset} pool price`);
  const usd = gasUsd(quote.expectedOut + quote.fees.total, price);
  console.log(JSON.stringify({ asset, sats: String(sats), expectedOut: String(quote.expectedOut), minOut: String(quote.minOut), outbound: String(quote.fees.outbound), usd, seconds: quote.seconds }));
  if (sats < quote.recommendedMinSats) throw new Error(`THORChain recommends at least ${quote.recommendedMinSats} sats`);
  const memo = memoMatches(quote.memo, { asset, destination, minOut: quote.minOut });
  if (memo !== true) throw new Error(`memo: ${memo}`);
  const refused = refuseFunding(usd, maxUsd, budget, spentOn(LEDGER, new Date().toISOString().slice(0, 10)));
  if (refused) throw new Error(`budget: ${refused}`);
  if (process.argv.includes('--quote-only')) return;

  const chain = new ElectrumChain(config.electrum.servers);
  try {
    const { coins, ownLocks } = await testWalletCoins(chain, keys);
    const plain = coins.filter((c) => !c.hasToken).sort((a, b) => (a.sats === b.sats ? 0 : a.sats > b.sats ? -1 : 1));
    const pay = route.buildOut(quote, plain);
    const sourceOutputs = pay.sourceOutputs.map(outputToWire);
    const tx = txToHex(pay.transaction);
    const vault = parseAddress(quote.vault, 'bitcoincash');
    if (typeof vault === 'string') throw new Error(`vault: ${vault}`);
    const check = checkTransaction(pay.transaction, pay.sourceOutputs, {
      userLockingBytecodes: ownLocks,
      inputPaths: pay.inputPaths,
      poolOwnerPkhs: [],
      deposits: [{ lockingBytecode: vault.lockingHex, sats }],
      opReturn: opReturnHex(quote.memo),
      thorDeposit: true,
      spend: { sats, tokens: {} },
      feeCapSats: BigInt(config.fees.capSats),
      receive: { category: config.tokens[config.defaultToken]!.category.toLowerCase(), min: 0n },
    });
    if (!check.ok) throw new Error(`checkTransaction rule ${check.rule}: ${check.reason}`);
    const signed = signWithHdKeys(keys, { tx, sourceOutputs, inputPaths: pay.inputPaths, userPrompt: '' });
    const vm = verifyTransaction(txFromHex(signed), pay.sourceOutputs);
    if (!vm.ok) throw new Error(`VM: ${vm.error}`);
    const txid = await chain.broadcast(signed);
    record(LEDGER, { utc: new Date().toISOString(), usd, prompt: `Gas funding: ${sats} sats BCH to ${asset} for the EVM test key (KMR5)` });
    console.log(`sent ${sats} sats to ${asset}, fee ${pay.feeSats} sats, txid ${txid}`);
  } finally {
    await chain.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then(
    () => process.exit(0),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
