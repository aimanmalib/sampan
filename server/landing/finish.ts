// Finishes every coin at one landing address: convert to tokens for the owner when the pools meet the contract
// minimum, otherwise give the BCH back once the coin is old enough. Used by the open-source finisher script and,
// later, by the server's own finisher. Holds no key: neither contract path needs a signature.
import { binToHex, encodeTransaction } from '@bitauth/libauth';
import { landingLockingHex, type LandingParams } from '../../core/landing.js';
import type { PoolUtxo } from '../../core/pools/trade.js';
import { buildGiveBackTx, LandingBuildError, planConvert, type LandingCoin } from '../../core/tx/landing.js';
import { planSpreadConvert, spreadOf, type FeeCoin } from '../../core/tx/spread.js';
import type { BuiltTx, Tx } from '../../core/tx/types.js';
import { verifyTransaction } from '../../core/tx/verify.js';
import { BroadcastError, type Chain, type ChainUtxo } from '../chain/types.js';

export type FinishMode = 'auto' | 'convert' | 'giveBack';

export interface FinishDeps {
  chain: Chain;
  /** Live pools of the landing's token, fresh from the chain. Called again after a pool was spent under us. */
  loadPools: (category: string) => Promise<PoolUtxo[]>;
  maxPools: number;
  satsPerByte: bigint;
  tokenDustSats: bigint;
  /** Convert attempts per coin when the pools move between build and broadcast. */
  attempts: number;
  /** Build and check only; print instead of broadcasting. */
  dryRun?: boolean;
  /** Sampan's spread on this landing (invoice addresses with pay.spreadBps > 0 only); absent = the whole coin to the owner. */
  spread?: SpreadDeps | undefined;
}

/** The fee wallet side of a spread convert (server/pay/spread.ts). */
export interface SpreadDeps {
  feeLockHex: string;
  /** Lends one fee coin at a time to `use`: concurrent converts would spend the same coin. */
  withFeeCoin<T>(use: (coin: FeeCoin | undefined) => Promise<T>): Promise<T>;
  /** Signs the fee coin input of a spread convert. */
  sign(built: BuiltTx): Tx;
}

/** `sats`: value of the coin at the landing address. `tokens`: what the owner received, `spreadSats`: what the fee address kept (converted only). */
export type FinishResult =
  | { coin: string; sats: bigint; action: 'converted' | 'returned'; txid: string; hex: string; feeSats: bigint; tokens?: bigint; spreadSats?: bigint }
  | { coin: string; sats: bigint; action: 'waiting' | 'skipped'; reason: string };

/** Blocks still to wait before giveBack is valid for a coin (0 = valid in the next block). */
export const blocksUntilReturn = (coin: ChainUtxo, tip: number, returnAfter: number): number => {
  if (coin.height <= 0) return returnAfter; // unconfirmed: the relative lock starts at its block
  return Math.max(0, returnAfter - (tip + 1 - coin.height));
};

async function send(built: BuiltTx, deps: FinishDeps): Promise<{ txid: string; hex: string }> {
  const vm = verifyTransaction(built.transaction, built.sourceOutputs);
  if (!vm.ok) throw new LandingBuildError(`the VM rejects the transaction: ${vm.error}`);
  const hex = binToHex(encodeTransaction(built.transaction));
  if (deps.dryRun) return { txid: '(dry run)', hex };
  return { txid: await deps.chain.broadcast(hex), hex };
}

/** The spread convert when there is a fee coin and the coin covers it; otherwise the ordinary convert (all to the owner). */
function plan(params: LandingParams, coin: LandingCoin, pools: PoolUtxo[], deps: FinishDeps, feeCoin: FeeCoin | undefined): BuiltTx {
  const o = { params, coin, pools, maxPools: deps.maxPools, satsPerByte: deps.satsPerByte, tokenDustSats: deps.tokenDustSats };
  if (deps.spread && feeCoin) {
    try {
      const built = planSpreadConvert({ ...o, feeCoin, feeLockHex: deps.spread.feeLockHex });
      return { ...built, transaction: deps.spread.sign(built) };
    } catch (e) {
      if (!(e instanceof LandingBuildError)) throw e;
    }
  }
  return planConvert(o);
}

async function tryConvert(params: LandingParams, coin: LandingCoin, deps: FinishDeps): Promise<FinishResult | string> {
  const lend = deps.spread ? deps.spread.withFeeCoin.bind(deps.spread) : <T>(use: (c: FeeCoin | undefined) => Promise<T>) => use(undefined);
  return lend((feeCoin) => convertAttempts(params, coin, deps, feeCoin));
}

async function convertAttempts(params: LandingParams, coin: LandingCoin, deps: FinishDeps, feeCoin: FeeCoin | undefined): Promise<FinishResult | string> {
  let last = 'no attempt';
  for (let i = 0; i < Math.max(1, deps.attempts); i++) {
    const pools = await deps.loadPools(params.category);
    let built: BuiltTx;
    try {
      built = plan(params, coin, pools, deps, feeCoin);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    try {
      const sent = await send(built, deps);
      const tokens = built.transaction.outputs[0]?.token?.amount ?? 0n;
      const spreadSats = built.userInputIndexes.length > 0 ? spreadOf(built) : undefined;
      return { coin: `${coin.txid}:${coin.vout}`, sats: coin.sats, action: 'converted', ...sent, feeSats: built.feeSats, tokens, ...(spreadSats === undefined ? {} : { spreadSats }) };
    } catch (e) {
      if (!(e instanceof BroadcastError) || !e.staleInputs) throw e;
      last = e.message; // a pool moved: load the pools again and rebuild
    }
  }
  return `pools kept moving: ${last}`;
}

export async function finishLanding(params: LandingParams, deps: FinishDeps, mode: FinishMode = 'auto'): Promise<FinishResult[]> {
  const coins = await deps.chain.listUnspent(landingLockingHex(params));
  const results: FinishResult[] = [];
  for (const u of coins) {
    const id = `${u.txid}:${u.vout}`;
    if (u.token) {
      results.push({ coin: id, sats: u.sats, action: 'skipped', reason: 'coin carries tokens; the contract only finishes BCH' });
      continue;
    }
    const coin: LandingCoin = { txid: u.txid, vout: u.vout, sats: u.sats };
    let why = '';
    if (mode !== 'giveBack') {
      const r = await tryConvert(params, coin, deps);
      if (typeof r !== 'string') {
        results.push(r);
        continue;
      }
      why = r;
      if (mode === 'convert') {
        results.push({ coin: id, sats: u.sats, action: 'waiting', reason: why });
        continue;
      }
    }
    const wait = blocksUntilReturn(u, await deps.chain.tipHeight(), params.returnAfter);
    if (wait > 0) {
      results.push({ coin: id, sats: u.sats, action: 'waiting', reason: `${why ? `${why}; ` : ''}giveBack possible in ${wait} more block(s)` });
      continue;
    }
    const built = buildGiveBackTx(params, coin, deps.satsPerByte);
    results.push({ coin: id, sats: u.sats, action: 'returned', ...(await send(built, deps)), feeSats: built.feeSats });
  }
  return results;
}
