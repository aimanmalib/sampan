// The fee wallet of a Sampan Pay spread (pay.spreadBps > 0, docs/decisions/0031-sampan-pay-spread.md). It lends one
// plain coin at business.feeAddress to each spread convert and signs that one input; the convert pays the coin back
// to the same address with the spread on top, so one coin keeps chaining. The public site runs with spreadBps 0 and
// never loads a key: the key is read only when the spread is on (SAMPAN_SPREAD_KEY, hex), and must belong to
// business.feeAddress.
import { binToHex, encodeLockingBytecodeP2pkh, hash160, hexToBin, secp256k1 } from '@bitauth/libauth';
import { parseAddress } from '../../core/address.js';
import { prefixOf } from '../../core/business.js';
import type { SampanConfig } from '../../core/config.js';
import { LANDING_RATE_DEN, type LandingParams } from '../../core/landing.js';
import { signP2pkhInputs } from '../../core/tx/sign.js';
import type { FeeCoin } from '../../core/tx/spread.js';
import { BCH_DUST_SATS, type BuiltTx, type Tx } from '../../core/tx/types.js';
import type { Chain } from '../chain/types.js';
import type { SpreadDeps } from '../landing/finish.js';

export class FeeWallet implements SpreadDeps {
  readonly feeLockHex: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly chain: Chain,
    private readonly key: Uint8Array,
    feeAddress: string,
  ) {
    const parsed = parseAddress(feeAddress, prefixOf(feeAddress));
    if (typeof parsed === 'string') throw new Error(`business.feeAddress: ${parsed}`);
    const pub = secp256k1.derivePublicKeyCompressed(key);
    if (typeof pub === 'string') throw new Error('SAMPAN_SPREAD_KEY is not a valid private key');
    const own = binToHex(encodeLockingBytecodeP2pkh(hash160(pub)));
    if (own !== parsed.lockingHex) throw new Error('SAMPAN_SPREAD_KEY does not belong to business.feeAddress');
    this.feeLockHex = own;
  }

  /** The largest plain coin at the fee address, one convert at a time. */
  withFeeCoin<T>(use: (coin: FeeCoin | undefined) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const coins = (await this.chain.listUnspent(this.feeLockHex)).filter((u) => !u.token && u.sats >= BCH_DUST_SATS);
      coins.sort((a, b) => (a.sats === b.sats ? 0 : a.sats > b.sats ? -1 : 1));
      const c = coins[0];
      return use(c ? { txid: c.txid, vout: c.vout, sats: c.sats, lockHex: this.feeLockHex } : undefined);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  sign(built: BuiltTx): Tx {
    return signP2pkhInputs(built.transaction, built.sourceOutputs, built.userInputIndexes, this.key);
  }
}

/** Only invoice addresses carry the spread: a plain landing (rateDen 100000000) converts all of its coin for the owner. */
export const isInvoiceLanding = (p: Pick<LandingParams, 'rateDen'>): boolean => p.rateDen !== LANDING_RATE_DEN;

/** The fee wallet when the spread is on, or null. Throws when the spread is on without a key that matches the fee address. */
export function feeWalletFrom(config: SampanConfig, chain: Chain, keyHex: string | undefined): FeeWallet | null {
  if (config.pay.spreadBps === 0) return null;
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('pay.spreadBps is above 0: SAMPAN_SPREAD_KEY (64 hex) of business.feeAddress is needed');
  return new FeeWallet(chain, hexToBin(keyHex), config.business.feeAddress);
}
