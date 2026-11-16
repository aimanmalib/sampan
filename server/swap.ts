// Swap quotes and unsigned swap transactions. Pools come from the directory (discovery), are refreshed from
// Electrum, the trade is chosen by core/pools/trade, the transaction by core/tx/swap, and the pool inputs are
// run through the libauth VM before anything is returned. Limits from config are enforced here.
import { hexToBin } from '@bitauth/libauth';
import { parseAddress, type CashPrefix } from '../core/address.js';
import { feeLockingHex, sampanFeeSats } from '../core/business.js';
import type { SampanConfig } from '../core/config.js';
import { selectTrade, type SelectedTrade, type TradeSide } from '../core/pools/trade.js';
import { buildSwapTx, SwapBuildError } from '../core/tx/swap.js';
import { BCH_DUST_SATS, type BuiltTx, type UserCoin } from '../core/tx/types.js';
import { verifyInputs } from '../core/tx/verify.js';
import type { Chain, ChainUtxo } from './chain/types.js';
import type { PoolDirectory } from './indexer.js';
import { refreshPools } from './pools.js';

export class SwapError extends Error {
  constructor(
    readonly code: 'bad_request' | 'below_min' | 'above_max' | 'no_liquidity' | 'not_enough_funds' | 'price_moved' | 'build_failed',
    message: string,
  ) {
    super(message);
  }
}

export interface QuoteRequest {
  token: string;
  side: TradeSide;
  /** Integer base units of what the user pays: satoshis for buy, token units for sell. */
  amount: bigint;
}

export interface Quote {
  token: string;
  category: string;
  side: TradeSide;
  supply: bigint;
  demand: bigint;
  /** Lowest amount the build will accept after slippage (for a sell: after the Sampan fee). */
  minReceive: bigint;
  /** Sampan fee in satoshis (business.feeBps of the BCH side; 0 when off or dust). */
  sampanFeeSats: bigint;
  pools: number;
  usd: number;
}

export interface BuildRequest extends QuoteRequest {
  minReceive: bigint;
  /** Addresses of this wallet with their derivation path ("receive/3"). Coins are picked from these. */
  addresses: Array<{ address: string; path: string }>;
  payoutAddress: string;
  changeAddress: string;
}

export interface BuiltSwap {
  quote: Quote;
  built: BuiltTx;
  inputPaths: Array<{ inputIndex: number; path: string }>;
  poolOwnerPkhs: string[];
  userLockingBytecodes: string[];
  attempts: number;
}

export interface SwapServiceOptions {
  config: SampanConfig;
  chain: Chain;
  pools: PoolDirectory;
  prefix: CashPrefix;
}

export class SwapService {
  constructor(private readonly o: SwapServiceOptions) {}

  private category(token: string): { category: string; decimals: number } {
    const t = this.o.config.tokens[token];
    const enabled = token === this.o.config.defaultToken || (token === 'MUSD' && this.o.config.features.musd);
    if (!t || !enabled) throw new SwapError('bad_request', `token ${token} is not offered`);
    return { category: t.category, decimals: t.decimals };
  }

  private trade(pools: Parameters<typeof selectTrade>[0], category: string, r: QuoteRequest): SelectedTrade {
    try {
      return selectTrade(pools, category, {
        side: r.side,
        target: 'supply',
        amount: r.amount,
        maxPools: this.o.config.cauldron.maxPoolsPerTx,
        satsPerByte: BigInt(this.o.config.fees.satsPerByte),
      });
    } catch (e) {
      throw new SwapError('no_liquidity', e instanceof Error ? e.message : 'no trade possible');
    }
  }

  private toQuote(token: string, decimals: number, t: SelectedTrade): Quote {
    const { limits, cauldron } = this.o.config;
    const sats = t.side === 'buy' ? t.supply : t.demand;
    const tokens = t.side === 'buy' ? t.demand : t.supply;
    const usd = Number(tokens) / 10 ** decimals;
    if (sats < BigInt(limits.localMinSats)) throw new SwapError('below_min', `the BCH side must be at least ${limits.localMinSats} sats`);
    if (usd > limits.maxUsd) throw new SwapError('above_max', `at most ${limits.maxUsd} USD per swap`);
    const fee = sampanFeeSats(sats, this.o.config.business.feeBps);
    const minReceive = (netDemand(t, fee) * BigInt(10_000 - cauldron.slippageBps)) / 10_000n;
    return { token, category: t.category, side: t.side, supply: t.supply, demand: t.demand, minReceive, sampanFeeSats: fee, pools: t.legs.length, usd };
  }

  async quote(r: QuoteRequest): Promise<Quote> {
    if (r.amount <= 0n) throw new SwapError('bad_request', 'amount must be positive');
    const { category, decimals } = this.category(r.token);
    const pools = await this.o.pools.active(category);
    return this.toQuote(r.token, decimals, this.trade(pools, category, r));
  }

  async build(r: BuildRequest): Promise<BuiltSwap> {
    if (r.amount <= 0n) throw new SwapError('bad_request', 'amount must be positive');
    const { category, decimals } = this.category(r.token);
    const lock = (a: string, needToken: boolean): string => {
      const p = parseAddress(a, this.o.prefix);
      if (typeof p === 'string') throw new SwapError('bad_request', `${a}: ${p}`);
      if (needToken && !p.tokenAware) throw new SwapError('bad_request', 'tokens can only be sent to a token address (z...)');
      return p.lockingHex;
    };
    const wallet = r.addresses.map((a) => ({ ...a, lock: lock(a.address, false) }));
    if (wallet.length === 0) throw new SwapError('bad_request', 'no wallet addresses');
    const payout = lock(r.payoutAddress, r.side === 'buy');
    const change = lock(r.changeAddress, r.side === 'sell');
    const userLocks = new Set(wallet.map((w) => w.lock));
    if (!userLocks.has(payout) || !userLocks.has(change)) throw new SwapError('bad_request', 'payout and change must be wallet addresses');

    const coins = await this.walletCoins(wallet, category);
    const attempts = this.o.config.cauldron.buildAttempts;
    let lastError = 'build failed';
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const fresh = await refreshPools(this.o.chain, await this.o.pools.active(category));
      const trade = this.trade(fresh, category, r);
      const quote = this.toQuote(r.token, decimals, trade);
      if (netDemand(trade, quote.sampanFeeSats) < r.minReceive) throw new SwapError('price_moved', 'the price moved past the quoted minimum; get a new quote');
      const margin = BigInt(this.o.config.landing.tokenDustSats + this.o.config.fees.capSats) + quote.sampanFeeSats;
      const feeLock = feeLockingHex(this.o.config.business, this.o.prefix);
      const picked = pickCoins(coins, r.side, category, trade.supply, margin);
      let built: BuiltTx;
      try {
        built = buildSwapTx({
          trade,
          coins: picked.map((c) => c.coin),
          payoutLockingBytecode: hex(payout),
          changeLockingBytecode: hex(change),
          satsPerByte: BigInt(this.o.config.fees.satsPerByte),
          tokenDustSats: BigInt(this.o.config.landing.tokenDustSats),
          ...(feeLock && quote.sampanFeeSats > 0n ? { sampanFee: { lockingBytecode: hex(feeLock), sats: quote.sampanFeeSats } } : {}),
        });
      } catch (e) {
        if (e instanceof SwapBuildError) throw new SwapError('not_enough_funds', e.message);
        throw e;
      }
      if (built.feeSats > BigInt(this.o.config.fees.capSats)) throw new SwapError('build_failed', 'network fee would be above the cap');
      const vm = verifyInputs(built.transaction, built.sourceOutputs, trade.legs.map((_, i) => i));
      if (!vm.ok) {
        lastError = vm.error;
        continue;
      }
      return {
        quote,
        built,
        inputPaths: built.userInputIndexes.map((inputIndex, i) => ({ inputIndex, path: picked[i]!.path })),
        poolOwnerPkhs: trade.legs.map((l) => l.pool.ownerPkh),
        userLockingBytecodes: [...userLocks],
        attempts: attempt,
      };
    }
    throw new SwapError('build_failed', `the pools did not verify after ${attempts} tries: ${lastError}`);
  }

  private async walletCoins(wallet: Array<{ path: string; lock: string }>, category: string): Promise<PathCoin[]> {
    const lists = await Promise.all(wallet.map(async (w) => ({ w, utxos: await this.o.chain.listUnspent(w.lock) })));
    return lists.flatMap(({ w, utxos }) => utxos.flatMap((u) => usable(u, category).map((coin) => ({ path: w.path, coin: { ...coin, lockingBytecode: hex(w.lock) } }))));
  }
}

export interface PathCoin {
  path: string;
  coin: UserCoin;
}

const hex = hexToBin;

/** What the user receives from the pools: for a sell, the BCH proceeds less the Sampan fee. */
const netDemand = (t: SelectedTrade, fee: bigint): bigint => (t.side === 'sell' ? t.demand - fee : t.demand);

/** Plain BCH coins and coins carrying only the swapped token; NFTs and other tokens are never touched. */
const usable = (u: ChainUtxo, category: string): Array<Omit<UserCoin, 'lockingBytecode'>> => {
  if (u.token && (u.token.nft || u.token.category !== category)) return [];
  return [{ txid: u.txid, vout: u.vout, sats: u.sats, ...(u.token ? { token: { category, amount: u.token.amount } } : {}) }];
};

/** Largest coins first until the trade (plus token dust and the fee cap for a buy) is covered. */
export function pickCoins(coins: PathCoin[], side: TradeSide, category: string, supply: bigint, satsMargin: bigint): PathCoin[] {
  const desc = (f: (c: PathCoin) => bigint) => (a: PathCoin, b: PathCoin) => (f(b) > f(a) ? 1 : f(b) < f(a) ? -1 : 0);
  const out: PathCoin[] = [];
  if (side === 'buy') {
    const need = supply + satsMargin + BCH_DUST_SATS;
    let have = 0n;
    for (const c of coins.filter((c) => !c.coin.token).sort(desc((c) => c.coin.sats))) {
      if (have >= need) break;
      out.push(c);
      have += c.coin.sats;
    }
    return out;
  }
  let have = 0n;
  for (const c of coins.filter((c) => c.coin.token?.category === category).sort(desc((c) => c.coin.token!.amount))) {
    if (have >= supply) break;
    out.push(c);
    have += c.coin.token!.amount;
  }
  return out;
}
