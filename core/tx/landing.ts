// Builders for finishing a landing coin. Pure: no I/O, no keys (neither path needs a signature).
// convert: [landing coin, pool 1..n] -> [tokens to owner, pool' 1..n]. Pools trade in whole token units, so the
// satoshis the trade cannot use stay with the owner on the token output (at least the token dust), not with miners.
// giveBack: [landing coin] -> [BCH to owner]; the input's sequence carries the relative age the contract checks.
import { encodeTransaction, hexToBin, type Input, type Output } from '@bitauth/libauth';
import {
  GIVE_BACK_MAX_FEE_SATS,
  landingLockingBytecode,
  landingUnlocking,
  minTokensFor,
  type LandingParams,
} from '../landing.js';
import { poolV0ExchangeUnlocking, poolV0LockingBytecode } from '../pools/template.js';
import { selectTrade, type PoolUtxo, type SelectedTrade } from '../pools/trade.js';
import { BCH_DUST_SATS, type BuiltTx } from './types.js';

/** A coin sitting at a landing address. */
export interface LandingCoin {
  txid: string;
  vout: number;
  sats: bigint;
}

export class LandingBuildError extends Error {
  constructor(
    message: string,
    /** Set when the only problem is the fee: the satoshis the miner fee must at least be. */
    readonly neededFeeSats?: bigint,
  ) {
    super(message);
  }
}

const tokenOf = (category: string, amount: bigint): NonNullable<Output['token']> => ({ category: hexToBin(category), amount });

const landingInput = (p: LandingParams, c: LandingCoin, fn: 'convert' | 'giveBack'): Input => ({
  outpointTransactionHash: hexToBin(c.txid),
  outpointIndex: c.vout,
  // giveBack: a relative lock in blocks equal to returnAfter (BIP68); convert: final.
  sequenceNumber: fn === 'giveBack' ? p.returnAfter : 0xffffffff,
  unlockingBytecode: landingUnlocking(p, fn),
});

const landingSource = (p: LandingParams, c: LandingCoin): Output => ({ lockingBytecode: landingLockingBytecode(p), valueSatoshis: c.sats });

export interface ConvertParams {
  params: LandingParams;
  coin: LandingCoin;
  /** A buy trade (BCH in, tokens out) of the landing's token whose supply is what the coin pays the pools. */
  trade: SelectedTrade;
  satsPerByte: bigint;
  tokenDustSats: bigint;
}

/**
 * Builds the convert transaction. Throws LandingBuildError when the trade pays fewer tokens than the
 * contract minimum, or when the trade leaves less than fee + token dust (neededFeeSats = the fee).
 */
export function buildConvertTx(c: ConvertParams): BuiltTx {
  const { params, coin, trade } = c;
  if (trade.side !== 'buy') throw new LandingBuildError('convert needs a buy trade');
  if (trade.category !== params.category) throw new LandingBuildError('trade is for another token');
  if (trade.legs.length === 0) throw new LandingBuildError('trade has no pool');
  const inputs: Input[] = [landingInput(params, coin, 'convert')];
  const sourceOutputs: Output[] = [landingSource(params, coin)];
  const outputs: Output[] = [
    { lockingBytecode: hexToBin(params.ownerLockHex), valueSatoshis: c.tokenDustSats, token: tokenOf(trade.category, trade.demand) },
  ];
  for (const leg of trade.legs) {
    const pkh = hexToBin(leg.pool.ownerPkh);
    const lock = poolV0LockingBytecode(pkh);
    inputs.push({ outpointTransactionHash: hexToBin(leg.pool.txid), outpointIndex: leg.pool.vout, sequenceNumber: 0xffffffff, unlockingBytecode: poolV0ExchangeUnlocking(pkh) });
    sourceOutputs.push({ lockingBytecode: lock, valueSatoshis: leg.pool.sats, token: tokenOf(trade.category, leg.pool.tokens) });
    outputs.push({ lockingBytecode: lock, valueSatoshis: leg.after.sats, token: tokenOf(trade.category, leg.after.tokens) });
  }
  const minimum = minTokensFor(params, coin.sats);
  if (trade.demand < minimum) throw new LandingBuildError(`trade pays ${trade.demand} tokens, the contract needs at least ${minimum}`);
  const transaction = { version: 2, locktime: 0, inputs, outputs };
  // Output values are fixed-width, so the size does not depend on the owner's satoshis.
  const sizeBytes = encodeTransaction(transaction).length;
  const feeSats = BigInt(sizeBytes) * c.satsPerByte;
  const ownerSats = coin.sats - trade.supply - feeSats;
  if (ownerSats < c.tokenDustSats) throw new LandingBuildError(`trade leaves ${coin.sats - trade.supply} sats, needs ${feeSats + c.tokenDustSats}`, feeSats);
  outputs[0]!.valueSatoshis = ownerSats;
  return { transaction, sourceOutputs, userInputIndexes: [], feeSats, sizeBytes };
}

/** Builds the giveBack transaction: all of the coin to the owner, less the miner fee (at most 1000 sats). */
export function buildGiveBackTx(params: LandingParams, coin: LandingCoin, satsPerByte: bigint): BuiltTx {
  const shape = (fee: bigint) => ({
    version: 2,
    locktime: 0,
    inputs: [landingInput(params, coin, 'giveBack')],
    outputs: [{ lockingBytecode: hexToBin(params.ownerLockHex), valueSatoshis: coin.sats - fee }],
  });
  const sizeBytes = encodeTransaction(shape(0n)).length;
  const feeSats = BigInt(sizeBytes) * satsPerByte;
  if (feeSats > GIVE_BACK_MAX_FEE_SATS) throw new LandingBuildError(`fee ${feeSats} is above the ${GIVE_BACK_MAX_FEE_SATS} sats the contract allows`);
  if (coin.sats - feeSats < BCH_DUST_SATS) throw new LandingBuildError('coin is too small to return');
  return { transaction: shape(feeSats), sourceOutputs: [landingSource(params, coin)], userInputIndexes: [], feeSats, sizeBytes };
}

export interface ConvertPlan {
  params: LandingParams;
  coin: LandingCoin;
  pools: PoolUtxo[];
  maxPools: number;
  satsPerByte: bigint;
  tokenDustSats: bigint;
}

/** First fee guess before the size is known: one landing input, one pool, two outputs. */
const FIRST_SIZE_GUESS = 400n;

/**
 * Best convert for a landing coin: every satoshi after the fee and the token dust goes into the trade. The fee
 * is guessed, the trade selected and the transaction measured; a short fee is corrected and the trade selected
 * again (a different pool count changes the size). Throws LandingBuildError when the minimum cannot be met.
 */
export function planConvert(o: ConvertPlan): BuiltTx {
  let fee = FIRST_SIZE_GUESS * o.satsPerByte;
  for (let round = 0; round < 4; round++) {
    const supply = o.coin.sats - o.tokenDustSats - fee;
    if (supply <= 0n) throw new LandingBuildError('coin is too small to convert');
    const trade = selectTrade(o.pools, o.params.category, { side: 'buy', target: 'supply', amount: supply, maxPools: o.maxPools, satsPerByte: o.satsPerByte });
    try {
      return buildConvertTx({ params: o.params, coin: o.coin, trade, satsPerByte: o.satsPerByte, tokenDustSats: o.tokenDustSats });
    } catch (e) {
      if (!(e instanceof LandingBuildError) || e.neededFeeSats === undefined) throw e;
      fee = e.neededFeeSats;
    }
  }
  throw new LandingBuildError('could not settle the fee for this convert');
}
