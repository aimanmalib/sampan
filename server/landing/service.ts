// Landing addresses (flow L): open one for an owner, and build the plain payment a connected wallet signs to pay it.
// The minimum rate comes from the worst case the PRD names: the smallest payment shown, less the convert fee and
// the token output's dust, priced on today's pools and lowered by the direct tolerance.
import { parseAddress, type CashPrefix } from '../../core/address.js';
import type { SampanConfig } from '../../core/config.js';
import { makeCard, type LandingCard } from '../../core/landing-card.js';
import { LANDING_RATE_DEN, landingLockingHex, rateNumFor, type LandingParams } from '../../core/landing.js';
import { selectTrade } from '../../core/pools/trade.js';
import { buildPayment, type Payment, type WalletCoin } from '../../core/tx/payment.js';
import type { Chain } from '../chain/types.js';
import type { Db, Origin } from '../db.js';
import type { PoolDirectory } from '../indexer.js';
import { SwapError } from '../swap.js';

export interface OpenedLanding {
  crossingId: string;
  card: LandingCard;
  /** Smallest payment that converts at the minimum rate (satoshis). */
  minSats: bigint;
  /** Tokens the contract pays at least for `minSats`. */
  tokensMin: bigint;
  /** True when this owner and rate already had an address; the earlier crossing is returned. */
  reused: boolean;
}

/** The smallest payment a landing address is priced for, and the tolerance below today's pools. */
export interface LandingFloor {
  minSats: bigint;
  toleranceBps: number;
}

export interface LandingServiceOptions {
  config: SampanConfig;
  chain: Chain;
  pools: PoolDirectory;
  db: Db;
  prefix: CashPrefix;
  testLocks: Set<string>;
  now?: () => Date;
}

export class LandingService {
  constructor(private readonly o: LandingServiceOptions) {}

  private token(symbol: string): { category: string } {
    const { config } = this.o;
    const t = config.tokens[symbol];
    const enabled = symbol === config.defaultToken || (symbol === 'MUSD' && config.features.musd);
    if (!t || !enabled) throw new SwapError('bad_request', `token ${symbol} is not offered`);
    return { category: t.category.toLowerCase() };
  }

  private ownerLock(address: string): string {
    const p = parseAddress(address, this.o.prefix);
    if (typeof p === 'string') throw new SwapError('bad_request', `${address}: ${p}`);
    return p.lockingHex;
  }

  /**
   * PRD flow L step 2: tokensMin and rateNum for the smallest payment shown. A crossing in (flow C step 2) passes the
   * route's minimum output and the wider route tolerance instead.
   */
  async minimumRate(category: string, at?: LandingFloor): Promise<{ minSats: bigint; tokensMin: bigint; rateNum: bigint }> {
    const { landing, limits, cauldron, fees } = this.o.config;
    const minSats = at?.minSats ?? BigInt(limits.localMinSats);
    const toleranceBps = at?.toleranceBps ?? landing.toleranceBpsDirect;
    const tradeSats = minSats - BigInt(landing.convertFeeSats) - BigInt(landing.tokenDustSats);
    let demand: bigint;
    try {
      const pools = await this.o.pools.active(category);
      demand = selectTrade(pools, category, {
        side: 'buy',
        target: 'supply',
        amount: tradeSats,
        maxPools: cauldron.maxPoolsPerTx,
        satsPerByte: BigInt(fees.satsPerByte),
      }).demand;
    } catch (e) {
      if (e instanceof Error && /indexer/i.test(e.message)) throw e;
      throw new SwapError('no_liquidity', e instanceof Error ? e.message : 'no trade possible');
    }
    const tokensMin = (demand * BigInt(10_000 - toleranceBps)) / 10_000n;
    if (tokensMin <= 0n) throw new SwapError('no_liquidity', 'the pools pay nothing for the minimum amount');
    return { minSats, tokensMin, rateNum: rateNumFor(tokensMin, minSats) };
  }

  async open(r: { ownerAddress: string; token: string }, at?: LandingFloor): Promise<OpenedLanding> {
    const { category } = this.token(r.token);
    const ownerLockHex = this.ownerLock(r.ownerAddress);
    const rate = await this.minimumRate(category, at);
    if (rate.minSats <= BigInt(this.o.config.landing.convertFeeSats + this.o.config.landing.tokenDustSats))
      throw new SwapError('below_min', 'the amount is too small to convert at a landing address');
    const params: LandingParams = {
      ownerLockHex,
      category,
      rateNum: rate.rateNum,
      rateDen: LANDING_RATE_DEN,
      returnAfter: this.o.config.landing.returnAfterBlocks,
    };
    const network = this.o.prefix === 'bitcoincash' ? 'mainnet' : 'chipnet';
    const card = makeCard(params, { network, token: r.token, created: this.o.now?.() ?? new Date() });
    const existing = this.o.db.landingByAddress(card.address);
    if (existing) {
      const stored = JSON.parse(existing.params_json) as LandingCard;
      return { crossingId: existing.crossing_id, card: stored, minSats: rate.minSats, tokensMin: rate.tokensMin, reused: true };
    }
    const origin: Origin = this.o.testLocks.has(ownerLockHex) ? 'test' : 'public';
    const crossingId = this.o.db.createCrossing({
      kind: 'land',
      status: 'open',
      asset: r.token,
      amount: rate.minSats.toString(),
      address: card.ownerAddress,
      depositAddress: card.address,
      origin,
    });
    this.o.db.createLanding({ address: card.address, crossingId, card });
    return { crossingId, card, minSats: rate.minSats, tokensMin: rate.tokensMin, reused: false };
  }

  /**
   * limits.maxUsd, priced at the address's own minimum rate (the tokens the contract pays at least). The pools usually
   * pay a little more, so a payment can land slightly above the cap; the check stops the large ones.
   */
  private checkMax(card: LandingCard, sats: bigint): void {
    const { limits, tokens } = this.o.config;
    const decimals = tokens[card.token]?.decimals ?? 0;
    const floorTokens = (sats * BigInt(card.rateNum)) / BigInt(card.rateDen);
    if (Number(floorTokens) / 10 ** decimals > limits.maxUsd)
      throw new SwapError('above_max', `at most ${limits.maxUsd} USD per landing payment`);
  }

  /** Plain payment of `sats` to the landing address from the listed wallet addresses, change to `changeAddress`. */
  async buildPayment(r: {
    crossingId: string;
    sats: bigint;
    addresses: Array<{ address: string; path: string }>;
    changeAddress: string;
  }): Promise<{ payment: Payment; landingLockHex: string; userLocks: string[] }> {
    const row = this.o.db.landingOf(r.crossingId);
    if (!row) throw new SwapError('bad_request', 'unknown landing address');
    const card = JSON.parse(row.params_json) as LandingCard;
    if (r.sats < BigInt(this.o.config.limits.localMinSats))
      throw new SwapError('below_min', `pay at least ${this.o.config.limits.localMinSats} sats to a landing address`);
    this.checkMax(card, r.sats);
    const wallet = r.addresses.map((a) => ({ ...a, lock: this.ownerLock(a.address) }));
    const change = this.ownerLock(r.changeAddress);
    if (!wallet.some((w) => w.lock === change)) throw new SwapError('bad_request', 'change must go to a wallet address');
    const lists = await Promise.all(wallet.map(async (w) => ({ w, utxos: await this.o.chain.listUnspent(w.lock) })));
    const coins: WalletCoin[] = lists.flatMap(({ w, utxos }) =>
      utxos.map((u) => ({ txid: u.txid, vout: u.vout, sats: u.sats, lockingHex: w.lock, path: w.path, hasToken: Boolean(u.token) })),
    );
    const landingLockHex = landingLockingHex({
      ownerLockHex: card.ownerLockHex,
      category: card.category,
      rateNum: BigInt(card.rateNum),
      rateDen: BigInt(card.rateDen),
      returnAfter: card.returnAfter,
    });
    let payment: Payment;
    try {
      payment = buildPayment({ coins, toLockingHex: landingLockHex, sats: r.sats, changeLockingHex: change, satsPerByte: BigInt(this.o.config.fees.satsPerByte) });
    } catch (e) {
      throw new SwapError('not_enough_funds', e instanceof Error ? e.message : 'not enough BCH');
    }
    if (payment.feeSats > BigInt(this.o.config.fees.capSats)) throw new SwapError('build_failed', 'network fee would be above the cap');
    return { payment, landingLockHex, userLocks: [...new Set(wallet.map((w) => w.lock))] };
  }
}
