// Balances of the test wallets, read only: nothing is signed or sent.
//   npx tsx tools/measure/funds.ts
// BCH and tokens: every address of the receive, change and defi paths of the mainnet test wallet, walked over Electrum
// until `wallet.gapLimit` unused addresses in a row. Each EVM chain in config: its gas coin and each configured token of
// the EVM test key, over the chain's first configured RPC. Prints the rows of the "Test wallet funds" table in docs/OPERATIONS.md. Needs the env file for the
// phrase and key (only public keys and the address are derived; neither secret is printed).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Hex } from 'viem';
import { hdKeysFromPhrase } from '../../core/client/session.js';
import { readCall, readResult } from '../../core/evm/calldata.js';
import { evmAddress } from '../../core/keys.js';
import { deriveAddress, WALLET_PATHS } from '../../core/wallet.js';
import { ElectrumChain } from '../../server/chain/electrum.js';
import { loadConfig } from '../../server/config.js';
import { SECRET_KEYS, parseEnv } from '../test-wallet/keys.js';
import { fundsLine, fundsRows, fundsTableHeader, sumCoins, walkPath, type FundsCoin } from './funds-scan.js';

/** What the judge flows need from the test wallets; the reasons are in docs/OPERATIONS.md "Test wallet funds". */
const NEEDED = { needed: '0', why: 'no judge flow spends Sampan funds' };

async function rpc(url: string, method: string, params: unknown[]): Promise<Hex | undefined> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const body = (await res.json()) as { result?: Hex };
    return body.result;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const env = parseEnv(readFileSync(path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env'), 'utf8'));
  const phrase = env.get(SECRET_KEYS.bchMainnet);
  const evmKey = env.get(SECRET_KEYS.evm);
  if (!phrase || !evmKey) throw new Error(`${SECRET_KEYS.bchMainnet} and ${SECRET_KEYS.evm} must be in the env file`);
  const config = loadConfig('config/sampan.json');
  const keys = hdKeysFromPhrase(phrase);
  const chain = new ElectrumChain(config.electrum.servers);
  const coins: FundsCoin[] = [];
  const looked: string[] = [];
  try {
    for (const p of WALLET_PATHS) {
      const walked = await walkPath(async (i) => {
        const lock = deriveAddress(keys.publicKey(p, i), p, i, 'bitcoincash').lockingHex;
        const [history, utxos] = await Promise.all([chain.historyCount(lock), chain.listUnspent(lock)]);
        return { used: history > 0, coins: utxos.map((u) => (u.token ? { sats: u.sats, token: { category: u.token.category, amount: u.token.amount } } : { sats: u.sats })) };
      }, config.wallet.gapLimit);
      coins.push(...walked.coins);
      looked.push(`${p} ${walked.looked}`);
    }
  } finally {
    await chain.close();
  }
  const evm = evmAddress(evmKey);
  const evmRows = [];
  for (const ch of config.evm.chains) {
    const url = ch.rpc[0]!;
    const balance = await rpc(url, 'eth_getBalance', [evm, 'latest']);
    const tokens = [];
    for (const [symbol, token] of Object.entries(ch.tokens)) {
      const units = await rpc(url, 'eth_call', [{ to: token.address, data: readCall.balanceOf(evm) }, 'latest']);
      tokens.push({ symbol, units: units ? readResult.uint('balanceOf', units) : undefined, decimals: token.decimals });
    }
    evmRows.push({ chain: ch.name, native: ch.native.symbol, balance: balance ? BigInt(balance) : undefined, tokens });
  }
  const rows = fundsRows({
    utc: new Date().toISOString().slice(0, 16).replace('T', ' '),
    bchWallet: deriveAddress(keys.publicKey('receive', 0), 'receive', 0, 'bitcoincash').address,
    evmWallet: evm,
    totals: sumCoins(coins),
    tokens: Object.values(config.tokens),
    evm: evmRows,
    needed: () => NEEDED,
  });
  console.log(`addresses looked at: ${looked.join(', ')}`);
  console.log([...fundsTableHeader, ...rows.map(fundsLine)].join('\n'));
}

void main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
