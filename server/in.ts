// "Bring in" from another chain through the active route (PRD flow C). The page's EVM wallet signs; this server
// holds no keys. Quote: the route's answer for the BCH address the user gave (what they would receive). Plan: when the
// user wants the stablecoin, a landing address priced at the route's minimum output becomes the destination and the
// route is asked again for it, right before the wallet signs. Limits from config are enforced on every quote.
import { parseAddress, type CashPrefix } from '../core/address.js';
import type { RouteId, SampanConfig } from '../core/config.js';
import type { LandingCard } from '../core/landing-card.js';
import type { LandingService } from './landing/service.js';
import { routeTarget } from './route-target.js';
import type { InPlan, InQuote, Route } from './routes/types.js';
import { RouteError } from './routes/types.js';
import { SwapError, type Quote, type SwapService } from './swap.js';

export const BCH = 'BCH';

export interface InRequest {
  /** Source stablecoin symbol and chain key (evm.chains). */
  symbol: string;
  chain: string;
  /** Source amount in the route's 1e8 units. */
  amount: bigint;
  /** 'BCH', or the default token (the BCH then lands at a landing address and converts). */
  receive: string;
  /** The user's BCH address: the destination for BCH, the owner of the landing address for the token. */
  address: string;
  /** The route to quote; absent = the active route. */
  route?: RouteId;
  /** The connected EVM address (refunds of a 1Click deposit go there; required for its plan). */
  from?: string;
}

export interface InView {
  quote: InQuote;
  /** Token contract on the source chain. */
  token: string;
  usd: number;
  /** Receiving the stablecoin: the Cauldron trade the landing address would make with the expected BCH (cost card). */
  convert?: Quote;
  /** USD per whole gas coin of the source chain, 8 decimals, from the route's pool; null when unknown. */
  gasAssetUsdE8: bigint | null;
}

export interface InPlanView extends InView {
  /** What the EVM wallet signs, from the route (router deposit, or one plain transfer for 1Click). */
  plan: InPlan;
  /** Present when the BCH lands at a landing address; the page recomputes the address from it. */
  landing?: { crossingId: string; card: LandingCard; tokensMin: bigint };
}

export class InService {
  constructor(
    private readonly o: {
      config: SampanConfig;
      /** The active route. */
      route: Route;
      /** Further routes config switches on (1Click), asked only when a request names them. */
      others?: Route[];
      landings: LandingService;
      swaps?: SwapService;
      prefix: CashPrefix;
      chainOpen?: (chain: string) => boolean;
    },
  ) {}

  private pick(id: RouteId | undefined): Route {
    const route = id === undefined || id === this.o.route.id ? this.o.route : this.o.others?.find((x) => x.id === id);
    if (!route) throw new RouteError('bad_request', 'that route is not offered');
    return route;
  }

  private source(r: InRequest): { asset: string; token: string } {
    const { config } = this.o;
    const { asset, token } = routeTarget(config, 'in', r, this.o.chainOpen ?? (() => true), this.pick(r.route).id);
    if (r.receive !== BCH && r.receive !== config.defaultToken) throw new RouteError('bad_request', `${r.receive} cannot be received`);
    if (typeof parseAddress(r.address, this.o.prefix) === 'string') throw new RouteError('bad_request', 'the BCH address is not valid');
    return { asset, token: token.address };
  }

  /** `refundTo` makes the route's quote a real one (1Click: with a deposit address). */
  private async ask(r: InRequest, asset: string, destination: string, refundTo?: string): Promise<{ quote: InQuote; usd: number }> {
    const route = this.pick(r.route);
    const { limits } = this.o.config;
    if (r.amount <= 0n) throw new RouteError('bad_request', 'amount must be positive');
    // Stablecoins in: the source amount is the value in USD.
    const usd = Number(r.amount) / 1e8;
    const floor = Math.max(limits.minUsd, limits.routeMinUsd[route.id]);
    if (usd < floor) throw new RouteError('below_route_min', `at least USD ${floor} per crossing`);
    if (usd > limits.maxUsd) throw new SwapError('above_max', `at most ${limits.maxUsd} USD per crossing`);
    const quote = await route.quoteIn({ asset, amount: r.amount, destination, ...(refundTo ? { refundTo } : {}) });
    return { quote, usd };
  }

  /** What the user would receive, quoted to their own address (no landing address is made while typing). */
  async quote(r: InRequest): Promise<InView> {
    const { asset, token } = this.source(r);
    const asked = await this.ask(r, asset, r.address);
    const [convert, gasAssetUsdE8] = await Promise.all([this.convertEstimate(r, asked.quote.expectedSats), this.gasPrice(r.chain)]);
    return { ...asked, token, ...(convert ? { convert } : {}), gasAssetUsdE8 };
  }

  /** The trade a landing address would make with `sats`, or nothing when it cannot be quoted now. */
  private async convertEstimate(r: InRequest, sats: bigint): Promise<Quote | undefined> {
    const { landing } = this.o.config;
    if (r.receive === BCH || !this.o.swaps) return undefined;
    const supply = sats - BigInt(landing.tokenDustSats) - BigInt(landing.convertFeeSats);
    if (supply <= 0n) return undefined;
    return this.o.swaps.quote({ token: r.receive, side: 'buy', amount: supply }).catch(() => undefined);
  }

  private async gasPrice(chain: string): Promise<bigint | null> {
    const native = this.o.config.evm.chains.find((c) => c.key === chain)?.native.symbol;
    return native ? this.o.route.gasAssetUsd(chain, native) : null;
  }

  /** A fresh quote to the final destination. The minimum may not fall below what the page showed. */
  async plan(r: InRequest & { minSats: bigint }): Promise<InPlanView> {
    const { asset, token } = this.source(r);
    const route = this.pick(r.route);
    // The refund address makes a 1Click quote real (with a deposit address): only the last quote, to the final
    // destination, carries it. THORChain ignores it.
    if (route.id === 'near-intents' && !r.from) throw new RouteError('placeholder_address', 'this route needs the connected wallet address for refunds');
    const first = await this.ask(r, asset, r.address, r.receive === BCH ? r.from : undefined);
    if (first.quote.minSats < r.minSats) throw new SwapError('price_moved', 'the price moved past the minimum shown; check the new amount');
    if (r.receive === BCH) return { ...first, token, gasAssetUsdE8: null, plan: route.buildIn(first.quote) };
    const opened = await this.o.landings.open(
      { ownerAddress: r.address, token: r.receive },
      { minSats: first.quote.minSats, toleranceBps: this.o.config.landing.toleranceBps },
    );
    const again = await this.ask(r, asset, opened.card.address, r.from);
    if (again.quote.minSats < r.minSats) throw new SwapError('price_moved', 'the price moved past the minimum shown; check the new amount');
    return { ...again, token, gasAssetUsdE8: null, plan: route.buildIn(again.quote), landing: { crossingId: opened.crossingId, card: opened.card, tokensMin: opened.tokensMin } };
  }
}
