// Route B: THORChain. Quotes from THORNode; the limit is computed here from the expected output and our own
// slippage setting (no tolerance_bps is sent) and written into the memo. BCH destinations go without prefix.
// Quotes are never cached: THORNode says so and they carry an expiry.
import { parseAddress } from '../../core/address.js';
import { limitFor, THOR_DECIMALS, withLimit, withoutPrefix } from '../../core/routes/memo.js';
import { buildDeposit } from '../../core/tx/deposit.js';
import { openMapOf, type InboundRow, type OpenMap } from '../../core/route-assets.js';
import type { WalletCoin } from '../../core/tx/payment.js';
import { ThornodeError, type Thornode } from './thornode.js';
import { RouteError, type CrossingStatus, type InQuote, type InPlan, type InRequest, type OutQuote, type OutRequest, type Route } from './types.js';

export const BCH_ASSET = 'BCH.BCH';

interface QuoteBody {
  inbound_address?: string;
  router?: string;
  memo?: string;
  expected_amount_out?: string;
  recommended_min_amount_in?: string;
  recommended_gas_rate?: string;
  expiry?: number;
  total_swap_seconds?: number;
  fees?: { total?: string; total_bps?: number };
}

interface StatusBody {
  tx?: { id?: string };
  planned_out_txs?: Array<{ chain: string; refund: boolean }>;
  out_txs?: Array<{ id: string; chain: string }>;
  stages?: { inbound_observed?: { completed?: boolean }; outbound_signed?: { completed?: boolean }; swap_finalised?: { completed?: boolean } };
}

const NO_TXID = /^0+$/;

export interface ThorchainOptions {
  node: Thornode;
  slippageBps: number;
  /** The site's own floor for the deposit fee rate. */
  minSatsPerByte: bigint;
  now?: () => number;
}

const num = (v: string | undefined, what: string): bigint => {
  if (v === undefined || !/^[0-9]+$/.test(v)) throw new RouteError('route_unavailable', `THORChain quote has no ${what}`);
  return BigInt(v);
};

export class ThorchainRoute implements Route {
  readonly id = 'thorchain' as const;
  constructor(private readonly o: ThorchainOptions) {}

  private async quote(from: string, to: string, amount: bigint, destination: string): Promise<QuoteBody> {
    try {
      return await this.o.node.request<QuoteBody>('/thorchain/quote/swap', { from_asset: from, to_asset: to, amount: amount.toString(), destination });
    } catch (e) {
      if (e instanceof ThornodeError && !e.unreachable) throw new RouteError('bad_request', `THORChain: ${e.message}`);
      throw new RouteError('route_unavailable', 'THORChain is not answering');
    }
  }

  private fresh(q: QuoteBody): number {
    const expiry = q.expiry ?? 0;
    if (expiry * 1000 <= (this.o.now ?? Date.now)()) throw new RouteError('route_unavailable', 'THORChain quote has already expired');
    return expiry;
  }

  async quoteOut(r: OutRequest): Promise<OutQuote> {
    const q = await this.quote(BCH_ASSET, r.asset, r.sats, r.destination);
    const expectedOut = num(q.expected_amount_out, 'expected output');
    const minOut = limitFor(expectedOut, this.o.slippageBps);
    const vault = `bitcoincash:${withoutPrefix(q.inbound_address ?? '')}`;
    if (typeof parseAddress(vault, 'bitcoincash') === 'string') throw new RouteError('route_unavailable', 'THORChain quote has no usable vault');
    const gas = num(q.recommended_gas_rate, 'gas rate');
    return {
      route: this.id,
      sats: r.sats,
      vault,
      memo: withLimit(q.memo ?? '', minOut),
      asset: r.asset,
      destination: r.destination,
      expectedOut,
      minOut,
      outDecimals: THOR_DECIMALS,
      fees: { total: num(q.fees?.total, 'fee total'), totalBps: q.fees?.total_bps ?? 0 },
      recommendedMinSats: num(q.recommended_min_amount_in, 'minimum amount'),
      satsPerByte: gas > this.o.minSatsPerByte ? gas : this.o.minSatsPerByte,
      expiry: this.fresh(q),
      seconds: q.total_swap_seconds ?? 0,
    };
  }

  buildOut(q: OutQuote, coins: WalletCoin[]) {
    const vault = parseAddress(q.vault, 'bitcoincash');
    if (typeof vault === 'string') throw new RouteError('route_unavailable', 'the vault address is not usable');
    return buildDeposit({ coins, vaultLockingHex: vault.lockingHex, sats: q.sats, memo: q.memo, satsPerByte: q.satsPerByte });
  }

  async quoteIn(r: InRequest): Promise<InQuote> {
    const destination = withoutPrefix(r.destination);
    const q = await this.quote(r.asset, BCH_ASSET, r.amount, destination);
    if (!q.router || !q.inbound_address) throw new RouteError('route_unavailable', 'THORChain quote has no router');
    const expectedSats = num(q.expected_amount_out, 'expected output');
    const minSats = limitFor(expectedSats, this.o.slippageBps);
    return {
      route: this.id,
      asset: r.asset,
      amount: r.amount,
      destination,
      expectedSats,
      minSats,
      router: q.router,
      vault: q.inbound_address,
      memo: withLimit(q.memo ?? '', minSats),
      expiry: this.fresh(q),
      seconds: q.total_swap_seconds ?? 0,
    };
  }

  buildIn(q: InQuote): InPlan {
    return { kind: 'router-deposit', router: q.router, vault: q.vault, asset: q.asset, amount: q.amount, memo: q.memo, expiry: q.expiry };
  }

  /** `txid` of the inbound: a BCH txid, or an EVM hash with or without 0x (THORNode wants it without). */
  async status(txid: string): Promise<CrossingStatus> {
    let s: StatusBody;
    try {
      s = await this.o.node.request<StatusBody>(`/thorchain/tx/status/${txid.replace(/^0x/i, '').toUpperCase()}`);
    } catch {
      throw new RouteError('route_unavailable', 'THORChain is not answering');
    }
    if (!s.stages?.inbound_observed?.completed) return { stage: 'unseen' };
    if (!s.stages.outbound_signed?.completed) return { stage: 'pending' };
    const refunded = (s.planned_out_txs ?? []).some((p) => p.refund);
    const sent = (s.out_txs ?? []).find((t) => t.chain !== 'THOR' && !NO_TXID.test(t.id));
    return { stage: refunded ? 'refunded' : 'done', ...(sent ? { outTxid: sent.id, outChain: sent.chain } : {}) };
  }

  /**
   * Open state of every chain THORChain lists, from one inbound_addresses read: open = not halted and neither chain
   * nor global trading paused. Throws when THORNode does not answer (the caller keeps "unknown", never "closed").
   */
  async open(): Promise<OpenMap> {
    let inbound: InboundRow[];
    try {
      inbound = await this.o.node.request<InboundRow[]>('/thorchain/inbound_addresses');
    } catch {
      throw new RouteError('route_unavailable', 'THORChain is not answering');
    }
    if (!Array.isArray(inbound)) throw new RouteError('route_unavailable', 'THORChain sent no chain list');
    return openMapOf(inbound);
  }
}
