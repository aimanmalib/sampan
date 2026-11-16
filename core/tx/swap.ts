// Builder for a BCH <-> token swap against Cauldron pools. Pure: no I/O, no keys.
// Layout: pool inputs at 0..n-1 and their new pool outputs at the same indexes, then the user's coins,
// then the payout output and an optional change output. Version 2, locktime 0. Fee: estimate the size
// with signature-sized placeholders, build, measure, correct once. An optional Sampan fee is one plain BCH
// output placed last; without it the bytes are exactly those of a swap without a fee.
import { encodeTransaction, hexToBin, type Input, type Output } from '@bitauth/libauth';
import { poolV0ExchangeUnlocking, poolV0LockingBytecode } from '../pools/template.js';
import type { SelectedTrade } from '../pools/trade.js';
import { BCH_DUST_SATS, P2PKH_UNLOCK_SIZE, type BuiltTx, type UserCoin } from './types.js';

export interface SwapParams {
  trade: SelectedTrade;
  coins: UserCoin[];
  /** Receives the bought tokens (buy) or the BCH proceeds (sell). */
  payoutLockingBytecode: Uint8Array;
  /** Receives left-over BCH (buy) or left-over tokens (sell). */
  changeLockingBytecode: Uint8Array;
  satsPerByte: bigint;
  tokenDustSats: bigint;
  /** Sampan fee output (business.feeBps), paid from the user's BCH change (buy) or proceeds (sell). */
  sampanFee?: { lockingBytecode: Uint8Array; sats: bigint };
}

export class SwapBuildError extends Error {}

const tokenOf = (category: string, amount: bigint): NonNullable<Output['token']> => ({ category: hexToBin(category), amount });

const coinInput = (c: UserCoin, unlock: Uint8Array): Input => ({
  outpointTransactionHash: hexToBin(c.txid),
  outpointIndex: c.vout,
  sequenceNumber: 0xffffffff,
  unlockingBytecode: unlock,
});

const coinOutput = (c: UserCoin): Output => ({
  lockingBytecode: c.lockingBytecode,
  valueSatoshis: c.sats,
  ...(c.token ? { token: tokenOf(c.token.category, c.token.amount) } : {}),
});

const assemble = (p: SwapParams, fee: bigint, placeholder: boolean): { tx: BuiltTx['transaction']; sourceOutputs: Output[] } => {
  const { trade, coins } = p;
  const poolInputs: Input[] = [];
  const poolOutputs: Output[] = [];
  const sourceOutputs: Output[] = [];
  for (const leg of trade.legs) {
    const pkh = hexToBin(leg.pool.ownerPkh);
    const lock = poolV0LockingBytecode(pkh);
    poolInputs.push({
      outpointTransactionHash: hexToBin(leg.pool.txid),
      outpointIndex: leg.pool.vout,
      sequenceNumber: 0xffffffff,
      unlockingBytecode: poolV0ExchangeUnlocking(pkh),
    });
    sourceOutputs.push({ lockingBytecode: lock, valueSatoshis: leg.pool.sats, token: tokenOf(trade.category, leg.pool.tokens) });
    poolOutputs.push({ lockingBytecode: lock, valueSatoshis: leg.after.sats, token: tokenOf(trade.category, leg.after.tokens) });
  }
  const unlock = new Uint8Array(placeholder ? P2PKH_UNLOCK_SIZE : 0);
  const satsIn = coins.reduce((s, c) => s + c.sats, 0n);
  const tokensIn = coins.reduce((s, c) => s + (c.token?.category === trade.category ? c.token.amount : 0n), 0n);
  if (coins.some((c) => c.token && c.token.category !== trade.category)) throw new SwapBuildError('coin carries another token');

  const extra: Output[] = [];
  const sampanFee = p.sampanFee && p.sampanFee.sats > 0n ? p.sampanFee : undefined;
  const feeSats = sampanFee?.sats ?? 0n;
  if (trade.side === 'buy') {
    const change = satsIn - trade.supply - p.tokenDustSats - fee - feeSats;
    extra.push({ lockingBytecode: p.payoutLockingBytecode, valueSatoshis: p.tokenDustSats, token: tokenOf(trade.category, trade.demand + tokensIn) });
    if (change < 0n) throw new SwapBuildError('not enough BCH for this swap');
    if (change >= BCH_DUST_SATS) extra.push({ lockingBytecode: p.changeLockingBytecode, valueSatoshis: change });
  } else {
    const leftTokens = tokensIn - trade.supply;
    if (leftTokens < 0n) throw new SwapBuildError('not enough tokens for this swap');
    const tokenChangeSats = leftTokens > 0n ? p.tokenDustSats : 0n;
    const payout = satsIn + trade.demand - tokenChangeSats - fee - feeSats;
    if (payout < BCH_DUST_SATS) throw new SwapBuildError('swap is too small to pay its fee');
    extra.push({ lockingBytecode: p.payoutLockingBytecode, valueSatoshis: payout });
    if (leftTokens > 0n) extra.push({ lockingBytecode: p.changeLockingBytecode, valueSatoshis: tokenChangeSats, token: tokenOf(trade.category, leftTokens) });
  }
  if (sampanFee) extra.push({ lockingBytecode: sampanFee.lockingBytecode, valueSatoshis: sampanFee.sats });
  const tx = {
    version: 2,
    locktime: 0,
    inputs: [...poolInputs, ...coins.map((c) => coinInput(c, unlock))],
    outputs: [...poolOutputs, ...extra],
  };
  return { tx, sourceOutputs: [...sourceOutputs, ...coins.map(coinOutput)] };
};

const sumOut = (outs: Output[]): bigint => outs.reduce((s, o) => s + o.valueSatoshis, 0n);

export const buildSwapTx = (p: SwapParams): BuiltTx => {
  if (p.trade.legs.length === 0) throw new SwapBuildError('trade has no pool');
  if (p.coins.length === 0) throw new SwapBuildError('no coins to spend');
  const probe = assemble(p, 0n, true);
  const size = encodeTransaction(probe.tx).length;
  const fee = BigInt(size) * p.satsPerByte;
  const signedShape = assemble(p, fee, true);
  const finalSize = encodeTransaction(signedShape.tx).length;
  const corrected = finalSize === size ? fee : BigInt(finalSize) * p.satsPerByte;
  const built = assemble(p, corrected, false);
  const actualFee = sumOut(built.sourceOutputs) - sumOut(built.tx.outputs);
  const n = p.trade.legs.length;
  return {
    transaction: built.tx,
    sourceOutputs: built.sourceOutputs,
    userInputIndexes: p.coins.map((_, i) => n + i),
    feeSats: actualFee,
    sizeBytes: finalSize,
  };
};
