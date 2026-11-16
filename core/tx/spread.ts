// Convert with Sampan's spread (pay.spreadBps > 0, docs/decisions/0031-sampan-pay-spread.md). Pure: no I/O, no key.
// The landing contract asks only that output 0 pays the owner at least the floor and that there are as many outputs
// as inputs. So the finisher buys exactly the floor for the owner and adds one pair of its own: a plain coin of the
// fee wallet as the last input, and the same coin plus the satoshis left over as the last output, to the fee
// address. [landing coin, pool 1..n, fee coin] -> [floor tokens to owner, pool' 1..n, fee coin + spread].
// The fee coin is the only input that needs a signature (userInputIndexes); the caller signs it.
import { encodeTransaction, hexToBin, type Input, type Output } from '@bitauth/libauth';
import { minTokensFor } from '../landing.js';
import { selectTrade } from '../pools/trade.js';
import { buildConvertTx, LandingBuildError, type ConvertPlan } from './landing.js';
import { P2PKH_UNLOCK_SIZE, type BuiltTx } from './types.js';

/** A plain BCH coin of the fee wallet (P2PKH), lent to the convert and paid back with the spread. */
export interface FeeCoin {
  txid: string;
  vout: number;
  sats: bigint;
  lockHex: string;
}

export interface SpreadPlan extends ConvertPlan {
  feeCoin: FeeCoin;
  /** Locking bytecode of business.feeAddress: the paired output. */
  feeLockHex: string;
}

/**
 * The convert that pays the owner exactly the contract floor and the rest, after the miner fee and the token dust,
 * to the fee address. Throws LandingBuildError when the pools ask more than the coin leaves for that (the caller
 * then converts the whole coin for the owner instead).
 */
export function planSpreadConvert(o: SpreadPlan): BuiltTx {
  const floor = minTokensFor(o.params, o.coin.sats);
  if (floor <= 0n) throw new LandingBuildError('the floor of this coin is zero tokens');
  const trade = selectTrade(o.pools, o.params.category, { side: 'buy', target: 'demand', amount: floor, maxPools: o.maxPools, satsPerByte: o.satsPerByte });
  if (trade.demand !== floor) throw new LandingBuildError(`the pools pay ${trade.demand} tokens for a target of ${floor}`);
  // The landing and pool part is the ordinary convert; its fee check is replaced by the one below.
  let base: BuiltTx;
  try {
    base = buildConvertTx({ params: o.params, coin: o.coin, trade, satsPerByte: o.satsPerByte, tokenDustSats: o.tokenDustSats });
  } catch (e) {
    if (!(e instanceof LandingBuildError) || e.neededFeeSats === undefined) throw e;
    throw new LandingBuildError(`the coin does not cover the floor trade: ${e.message}`);
  }
  const feeLock = hexToBin(o.feeLockHex);
  const input: Input = {
    outpointTransactionHash: hexToBin(o.feeCoin.txid),
    outpointIndex: o.feeCoin.vout,
    sequenceNumber: 0xffffffff,
    unlockingBytecode: new Uint8Array(P2PKH_UNLOCK_SIZE), // replaced by the signature; same length
  };
  const transaction = {
    ...base.transaction,
    inputs: [...base.transaction.inputs, input],
    outputs: [...base.transaction.outputs.map((out, i) => (i === 0 ? { ...out, valueSatoshis: o.tokenDustSats } : out)), { lockingBytecode: feeLock, valueSatoshis: o.feeCoin.sats }],
  };
  const sourceOutputs: Output[] = [...base.sourceOutputs, { lockingBytecode: hexToBin(o.feeCoin.lockHex), valueSatoshis: o.feeCoin.sats }];
  const sizeBytes = encodeTransaction(transaction).length;
  const feeSats = BigInt(sizeBytes) * o.satsPerByte;
  const spread = o.coin.sats - trade.supply - o.tokenDustSats - feeSats;
  if (spread < 0n) throw new LandingBuildError(`the floor trade leaves ${spread + feeSats} sats, the fee is ${feeSats}`);
  transaction.outputs[transaction.outputs.length - 1] = { lockingBytecode: feeLock, valueSatoshis: o.feeCoin.sats + spread };
  return { transaction, sourceOutputs, userInputIndexes: [transaction.inputs.length - 1], feeSats, sizeBytes };
}

/** Satoshis a spread convert pays the fee address on top of the coin it lent. */
export const spreadOf = (built: BuiltTx): bigint => {
  const last = built.transaction.outputs.length - 1;
  return built.transaction.outputs[last]!.valueSatoshis - built.sourceOutputs[last]!.valueSatoshis;
};
