// Pay plain BCH from the mainnet test wallet, inside the test budget.
//   npm run test-wallet:send -- <bitcoincash:address> <bch> --usd <value> [--why "text for the ledger"]
// Scans the first addresses of the receive and change paths over Electrum, pays from plain coins, sends change
// to change/0, checks the signed transaction in the VM, broadcasts it and records the spend.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseAddress } from '../../core/address.js';
import { hdKeysFromPhrase, signWithHdKeys } from '../../core/client/session.js';
import { verifyTransaction } from '../../core/tx/verify.js';
import { deriveAddress, parseUnits } from '../../core/wallet.js';
import { outputToWire, txFromHex, txToHex } from '../../core/wire.js';
import { ElectrumChain } from '../../server/chain/electrum.js';
import { loadConfig } from '../../server/config.js';
import { SECRET_KEYS, parseEnv } from './keys.js';
import { record, spentOn } from './ledger.js';
import { buildPayment } from '../../core/tx/payment.js';
import { testWalletCoins } from './coins.js';
import type { Budget } from './policy.js';

async function main(): Promise<void> {
  const [to, bch] = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const usd = Number(flag('--usd'));
  const sats = bch ? parseUnits(bch, 8) : undefined;
  const dest = to ? parseAddress(to, 'bitcoincash') : 'missing address';
  if (typeof dest === 'string' || sats === undefined || !(usd > 0)) throw new Error('usage: send.ts <bitcoincash:address> <bch> --usd <value>');
  const budget = JSON.parse(readFileSync('state/budget.json', 'utf8')) as Budget;
  const ledger = 'state/test-ledger.jsonl';
  const spent = spentOn(ledger, new Date().toISOString().slice(0, 10));
  if (usd > budget.maxUsdPerTx || spent + usd > budget.maxUsdPerDay) throw new Error(`USD ${usd} is outside the budget (spent today ${spent})`);

  const env = parseEnv(readFileSync(path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env'), 'utf8'));
  const phrase = env.get(SECRET_KEYS.bchMainnet);
  if (!phrase) throw new Error(`${SECRET_KEYS.bchMainnet} is missing from the env file`);
  const keys = hdKeysFromPhrase(phrase);
  const config = loadConfig('config/sampan.json');
  const chain = new ElectrumChain(config.electrum.servers);
  try {
    const { coins } = await testWalletCoins(chain, keys);
    const change = deriveAddress(keys.publicKey('change', 0), 'change', 0, 'bitcoincash');
    const pay = buildPayment({ coins, toLockingHex: dest.lockingHex, sats, changeLockingHex: change.lockingHex, satsPerByte: BigInt(config.fees.satsPerByte) });
    if (pay.feeSats > BigInt(config.fees.capSats)) throw new Error(`fee ${pay.feeSats} is above the cap`);
    const sourceOutputs = pay.sourceOutputs.map(outputToWire);
    const signed = signWithHdKeys(keys, { tx: txToHex(pay.transaction), sourceOutputs, inputPaths: pay.inputPaths, userPrompt: '' });
    const vm = verifyTransaction(txFromHex(signed), pay.sourceOutputs);
    if (!vm.ok) throw new Error(`VM: ${vm.error}`);
    const txid = await chain.broadcast(signed);
    record(ledger, { utc: new Date().toISOString(), usd, prompt: flag('--why') ?? `Pay ${bch} BCH to ${to}` });
    console.log(`sent ${bch} BCH, fee ${pay.feeSats} sats, txid ${txid}`);
  } finally {
    await chain.close();
  }
}

void main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
