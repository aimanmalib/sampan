// The mainnet test wallet's coins: the first addresses of its receive and change paths, read over Electrum.
// Used by the scripts that pay from the test wallet without a page (send.ts, gas-fund.ts).
import type { HdKeys } from '../../core/client/session.js';
import type { WalletCoin } from '../../core/tx/payment.js';
import { deriveAddress } from '../../core/wallet.js';
import type { ElectrumChain } from '../../server/chain/electrum.js';

export const ADDRESSES_PER_PATH = 25;

export async function testWalletCoins(chain: Pick<ElectrumChain, 'listUnspent'>, keys: Pick<HdKeys, 'publicKey'>): Promise<{ coins: WalletCoin[]; ownLocks: string[] }> {
  const coins: WalletCoin[] = [];
  const ownLocks: string[] = [];
  for (const p of ['receive', 'change'] as const) {
    for (let i = 0; i < ADDRESSES_PER_PATH; i++) {
      const a = deriveAddress(keys.publicKey(p, i), p, i, 'bitcoincash');
      ownLocks.push(a.lockingHex);
      for (const u of await chain.listUnspent(a.lockingHex))
        coins.push({ txid: u.txid, vout: u.vout, sats: u.sats, lockingHex: a.lockingHex, path: `${p}/${i}`, hasToken: !!u.token });
    }
  }
  return { coins, ownLocks };
}
