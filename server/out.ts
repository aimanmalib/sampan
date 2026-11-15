// "Send out": quotes and the deposit transaction for the active route. From the stablecoin the page first
// swaps tokens to BCH (step 1, the swap flow) and then deposits that BCH (step 2); from BCH it deposits
// directly. The deposit amount for step 1 is what the swap pays minus a safety margin and both network fees,
// so the user never needs BCH of their own. Limits from config are enforced here on every quote.
import { parseAddress, type CashPrefix } from '../core/address.js';
import type { SampanConfig } from '../core/config.js';
import { thorAsset } from '../core/routes/memo.js';
import { depositSize, DepositBuildError } from '../core/tx/deposit.js';
import type { Payment, WalletCoin } from '../core/tx/payment.js';
import { BCH_DUST_SATS } from '../core/tx/types.js';
import type { Chain } from './chain/types.js';
import type { OutQuote, Route } from './routes/types.js';
import { RouteError } from './routes/types.js';
import { SwapError, type Quote, type SwapService } from './swap.js';

export const BCH = 'BCH';
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface OutRequest {
  /** 'BCH' or the token symbol (the default token). */
  source: string;
  /** Base units of the source: satoshis, or token units. */
  amount: bigint;
  symbol: string;
  chain: string;
  destination: string;
}

export interface OutView {
  source: string;
  amount: bigint;
  /** Step 1 (token source only): the swap that turns the tokens into BCH. */
  swap?: Quote;
  quote: OutQuote;
  /** Value of the crossing in USD (stablecoin output plus the route's fees). */
  usd: number;
}

export interface OutBuildRequest extends OutRequest {
  minOut: bigint;
  addresses: Array<{ address: string; path: string }>;
  /** Step 2: the transaction of step 1 whose BCH output becomes input 0. */
  fromTxid?: string;
}

export interface BuiltOut {
  view: OutView;
  payment: Payment;
  userLocks: string[];
}

export class OutService {
  constructor(private readonly o: { config: SampanConfig; route: Route; swaps: SwapService; chain: Chain; prefix: CashPrefix }) {}

  private target(r: OutRequest): { asset: string; decimals: number } {
    const { config } = this.o;
    if (!config.route.symbols.includes(r.symbol)) throw new RouteError('bad_request', `${r.symbol} is not offered`);
    const chain = config.evm.chains.find((c) => c.key === r.chain);
    const contract = chain?.tokens[r.symbol];
    if (!chain || !contract || !config.thorchain.chains.includes(r.chain)) throw new RouteError('bad_request', `${r.chain} is not offered`);
    if (!EVM_ADDRESS.test(r.destination)) throw new RouteError('bad_request', 'the destination is not an address on that chain');
    return { asset: thorAsset(r.chain, r.symbol, contract), decimals: 8 };
  }

  /** Satoshis to deposit and the step 1 swap, if any. */
  private async depositSats(r: OutRequest): Promise<{ sats: bigint; swap?: Quote }> {
    const { config } = this.o;
    if (r.source === BCH) return { sats: r.amount };
    if (r.source !== config.defaultToken) throw new RouteError('bad_request', `${r.source} cannot be sent out`);
    const swap = await this.o.swaps.quote({ token: r.source, side: 'sell', amount: r.amount });
    const safe = (swap.minReceive * BigInt(10_000 - config.cauldron.outSafetyBps)) / 10_000n;
    // Step 2 fee at a generous rate for an 80-byte memo; step 1 fee at its cap; change must stay spendable.
    const step2 = BigInt(depositSize(1, 'x'.repeat(80))) * BigInt(config.thorchain.maxGasRate);
    return { sats: safe - BigInt(config.fees.capSats) - step2 - BCH_DUST_SATS, swap };
  }

  async quote(r: OutRequest): Promise<OutView> {
    if (r.amount <= 0n) throw new RouteError('bad_request', 'amount must be positive');
    const { asset } = this.target(r);
    const { sats, swap } = await this.depositSats(r);
    const { limits } = this.o.config;
    const floor = Math.max(limits.minUsd, limits.routeMinUsd[this.o.route.id]);
    if (sats <= BCH_DUST_SATS) throw new RouteError('below_route_min', `at least USD ${floor} per crossing`);
    const quote = await this.o.route.quoteOut({ sats, asset, destination: r.destination });
    const usd = Number(quote.expectedOut + quote.fees.total) / 10 ** quote.outDecimals;
    if (usd < floor || sats < quote.recommendedMinSats) throw new RouteError('below_route_min', `at least USD ${floor} per crossing`);
    if (usd > limits.maxUsd) throw new SwapError('above_max', `at most ${limits.maxUsd} USD per crossing`);
    if (quote.satsPerByte > BigInt(this.o.config.thorchain.maxGasRate)) throw new RouteError('route_unavailable', 'the route asks for an unusual fee rate');
    return { source: r.source, amount: r.amount, ...(swap ? { swap } : {}), quote, usd };
  }

  /** A fresh quote and the deposit transaction. The minimum may not fall below what the page showed. */
  async build(r: OutBuildRequest): Promise<BuiltOut> {
    if (r.source !== BCH && !r.fromTxid) throw new RouteError('bad_request', 'step 2 needs the transaction of step 1');
    const wallet = r.addresses.map((a) => {
      const p = parseAddress(a.address, this.o.prefix);
      if (typeof p === 'string') throw new RouteError('bad_request', `${a.address}: ${p}`);
      return { path: a.path, lock: p.lockingHex };
    });
    const lists = await Promise.all(wallet.map(async (w) => ({ w, utxos: await this.o.chain.listUnspent(w.lock) })));
    const plain: WalletCoin[] = lists
      .flatMap(({ w, utxos }) => utxos.map((u) => ({ txid: u.txid, vout: u.vout, sats: u.sats, lockingHex: w.lock, path: w.path, hasToken: Boolean(u.token) })))
      .filter((c) => !c.hasToken)
      .sort((a, b) => (a.sats === b.sats ? 0 : a.sats > b.sats ? -1 : 1));
    let coins = plain;
    let sats: bigint | undefined;
    if (r.fromTxid) {
      // Step 2 deposits what step 1 paid, minus the deposit fee and the change THORChain wants back.
      const first = plain.find((c) => c.txid === r.fromTxid);
      if (!first) throw new RouteError('bad_request', 'the BCH from step 1 is not in this wallet yet');
      coins = [first];
      sats = first.sats - BigInt(depositSize(1, 'x'.repeat(80))) * BigInt(this.o.config.thorchain.maxGasRate) - BCH_DUST_SATS;
    }
    const view = await this.quote(sats === undefined ? r : { ...r, source: BCH, amount: sats });
    if (view.quote.minOut < r.minOut) throw new SwapError('price_moved', 'the price moved past the minimum shown; check the new amount');
    let payment: Payment;
    try {
      payment = this.o.route.buildOut(view.quote, coins);
    } catch (e) {
      if (e instanceof DepositBuildError) throw new SwapError('not_enough_funds', e.message);
      throw e;
    }
    if (payment.feeSats > BigInt(this.o.config.fees.capSats)) throw new SwapError('build_failed', 'network fee would be above the cap');
    return { view, payment, userLocks: [...new Set(wallet.map((w) => w.lock))] };
  }
}
