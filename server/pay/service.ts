// Sampan Pay (docs/decisions/0027-sampan-pay-invoices.md): an invoice is a landing address of the unchanged contract
// whose owner is the merchant and whose floor is the invoice in PUSD. rateDen = 100000000 + a random nonce gives each
// invoice its own address. The landing finisher converts what arrives, as for any landing; this module only reads
// what it reported and works out the invoice status. Holds no key.
import { randomBytes, randomInt } from 'node:crypto';
import { parseAddress, type CashPrefix } from '../../core/address.js';
import type { SampanConfig } from '../../core/config.js';
import { makeCard } from '../../core/landing-card.js';
import { landingParamsProblem, type LandingParams } from '../../core/landing.js';
import { bip21, invoiceRate, requiredSatsFor, usdToTokens } from '../../core/pay/quote.js';
import { invoiceStatus, type InvoiceStatus } from '../../core/pay/status.js';
import { selectTrade } from '../../core/pools/trade.js';
import { ApiError } from '../api/guard.js';
import { Db, type LandingRow, type Origin } from '../db.js';
import type { PoolDirectory } from '../indexer.js';
import type { FinishResult } from '../landing/finish.js';
import { SwapError } from '../swap.js';
import { webhookTarget, type Lookup } from './ssrf.js';
import { PayStore, type InvoiceRow, type StoredPayment } from './store.js';

/** Draws before giving up on a free nonce (the space is at least 100 times the open invoices, see core/pay/config). */
const NONCE_DRAWS = 32;
const SECRET = /^whsec_[A-Za-z0-9+/]{32,}={0,2}$/;

export interface NewInvoiceRequest {
  usd: number;
  merchantAddress: string;
  webhookUrl?: string;
  webhookSecret?: string;
  orderId?: string;
  returnUrl?: string;
}

export interface CreatedInvoice {
  id: string;
  address: string;
  bip21: string;
  qrSvgUrl: string;
  statusUrl: string;
  usd: string;
  requiredSats: string;
  expiresAt: string;
  /** Only when the server generated the secret: shown once, never again. */
  webhookSecret?: string;
}

export interface InvoiceView {
  id: string;
  status: InvoiceStatus;
  usd: string;
  address: string;
  bip21: string;
  requiredSats: string;
  paidSats: string;
  expiresAt: string;
  createdAt: string;
  orderId: string | null;
  returnUrl: string | null;
  payments: Array<{ txid: string; sats: string }>;
  convert: Array<{ txid: string; pusd: string }>;
  webhook: { state: string; attempts: number };
}

export interface PayServiceOptions {
  config: SampanConfig;
  db: Db;
  pools: PoolDirectory;
  prefix: CashPrefix;
  testLocks: Set<string>;
  /** DNS for the webhook address check (server/pay/ssrf.ts). */
  lookup: Lookup;
  now?: () => number;
  /** Nonce source (tests); defaults to crypto randomInt over 1..pay.maxNonce. */
  nonce?: () => number;
}

const isHttps = (u: string): boolean => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

export class PayService {
  readonly store: PayStore;
  private readonly now: () => number;

  constructor(private readonly o: PayServiceOptions) {
    this.now = o.now ?? ((): number => Date.now());
    this.store = new PayStore(o.db.handle, this.now);
  }

  private get token(): { symbol: string; category: string; decimals: number } {
    const t = this.o.config.tokens[this.o.config.defaultToken]!;
    return { symbol: t.symbol, category: t.category.toLowerCase(), decimals: t.decimals };
  }

  private merchantLock(address: string): string {
    const p = parseAddress(address, this.o.prefix);
    if (typeof p === 'string') throw new SwapError('bad_request', `merchantAddress: ${p}`);
    if (!p.tokenAware) throw new SwapError('bad_request', 'merchantAddress must be a token-aware address (z... or r...) that can receive PUSD');
    return p.lockingHex;
  }

  private checkRequest(r: NewInvoiceRequest): bigint {
    const { pay } = this.o.config;
    if (typeof r.usd !== 'number' || !Number.isFinite(r.usd)) throw new SwapError('bad_request', 'usd must be a number');
    if (r.usd < pay.minUsd) throw new SwapError('below_min', `an invoice is at least ${pay.minUsd} USD`);
    if (r.usd > pay.maxUsd) throw new SwapError('above_max', `an invoice is at most ${pay.maxUsd} USD`);
    const tokens = usdToTokens(r.usd, this.token.decimals);
    if (typeof tokens === 'string') throw new SwapError('bad_request', tokens);
    if (r.webhookSecret !== undefined && r.webhookUrl === undefined) throw new SwapError('bad_request', 'webhookSecret needs a webhookUrl');
    if (r.webhookSecret !== undefined && !SECRET.test(r.webhookSecret)) throw new SwapError('bad_request', 'webhookSecret must be whsec_ followed by base64 of at least 24 bytes');
    if (r.returnUrl !== undefined && !isHttps(r.returnUrl)) throw new SwapError('bad_request', 'returnUrl must be an https URL');
    return tokens;
  }

  /** Satoshis the pools ask today for `tokens`. */
  private async tradeSats(tokens: bigint): Promise<bigint> {
    const { cauldron, fees } = this.o.config;
    try {
      const pools = await this.o.pools.active(this.token.category);
      return selectTrade(pools, this.token.category, {
        side: 'buy',
        target: 'demand',
        amount: tokens,
        maxPools: cauldron.maxPoolsPerTx,
        satsPerByte: BigInt(fees.satsPerByte),
      }).supply;
    } catch (e) {
      if (e instanceof Error && /indexer/i.test(e.message)) throw e;
      throw new SwapError('no_liquidity', e instanceof Error ? e.message : 'no trade possible');
    }
  }

  async create(r: NewInvoiceRequest): Promise<CreatedInvoice> {
    const { config, db } = this.o;
    const tokens = this.checkRequest(r);
    const merchantLock = this.merchantLock(r.merchantAddress);
    if (r.webhookUrl !== undefined) {
      const target = await webhookTarget(r.webhookUrl, { allowPrivate: config.pay.webhook.allowPrivate, lookup: this.o.lookup });
      if (typeof target === 'string') throw new SwapError('bad_request', target);
    }
    const t = this.now();
    const taken = this.store.openNonces(merchantLock, t);
    if (taken.size >= config.pay.maxOpenInvoices) throw new ApiError(429, 'too_many_open', `at most ${config.pay.maxOpenInvoices} open invoices per merchant`);
    const requiredSats = requiredSatsFor({
      tradeSats: await this.tradeSats(tokens),
      bufferBps: config.pay.quoteBufferBps,
      convertFeeSats: config.landing.convertFeeSats,
      tokenDustSats: config.landing.tokenDustSats,
      spreadBps: config.pay.spreadBps,
    });
    const network = this.o.prefix === 'bitcoincash' ? 'mainnet' : 'chipnet';
    for (let draw = 0; draw < NONCE_DRAWS; draw++) {
      const nonce = this.o.nonce?.() ?? randomInt(1, config.pay.maxNonce + 1);
      if (taken.has(nonce)) continue;
      const params: LandingParams = { ownerLockHex: merchantLock, category: this.token.category, ...invoiceRate(tokens, requiredSats, nonce), returnAfter: config.landing.returnAfterBlocks };
      const problem = landingParamsProblem(params, config.pay.maxNonce);
      if (problem) throw new Error(`invoice parameters: ${problem}`);
      const card = makeCard(params, { network, token: this.token.symbol, created: new Date(t) });
      if (db.landingByAddress(card.address)) continue;
      return this.persist(r, { nonce, card, merchantLock, tokens, requiredSats, t });
    }
    throw new ApiError(503, 'busy', 'no free invoice address right now; try again');
  }

  private persist(
    r: NewInvoiceRequest,
    x: { nonce: number; card: ReturnType<typeof makeCard>; merchantLock: string; tokens: bigint; requiredSats: bigint; t: number },
  ): CreatedInvoice {
    const { config, db } = this.o;
    const origin: Origin = this.o.testLocks.has(x.merchantLock) ? 'test' : 'public';
    const crossingId = db.createCrossing({
      kind: 'land',
      status: 'open',
      asset: this.token.symbol,
      amount: x.requiredSats.toString(),
      address: x.card.ownerAddress,
      depositAddress: x.card.address,
      route: 'pay',
      origin,
    });
    db.createLanding({ address: x.card.address, crossingId, card: x.card });
    const generated = r.webhookUrl !== undefined && r.webhookSecret === undefined ? `whsec_${randomBytes(24).toString('base64')}` : undefined;
    const id = Db.newId();
    const expiresAt = x.t + config.pay.validMinutes * 60_000;
    const usd = (Number(x.tokens) / 10 ** this.token.decimals).toFixed(this.token.decimals);
    this.store.create({
      id,
      crossing_id: crossingId,
      address: x.card.address,
      merchant_address: x.card.ownerAddress,
      merchant_lock: x.merchantLock,
      nonce: x.nonce,
      usd,
      tokens: x.tokens.toString(),
      required_sats: x.requiredSats.toString(),
      status: 'open',
      expires_at: expiresAt,
      order_id: r.orderId ?? null,
      return_url: r.returnUrl ?? null,
      webhook_url: r.webhookUrl ?? null,
      webhook_secret: r.webhookSecret ?? generated ?? null,
      webhook_state: r.webhookUrl === undefined ? 'none' : 'pending',
    });
    const site = config.site.url;
    return {
      id,
      address: x.card.address,
      bip21: bip21(x.card.address, x.requiredSats),
      qrSvgUrl: `${site}/api/pay/invoice/${id}/qr.svg`,
      statusUrl: `${site}/pay/i/${id}`,
      usd,
      requiredSats: x.requiredSats.toString(),
      expiresAt: new Date(expiresAt).toISOString(),
      ...(generated ? { webhookSecret: generated } : {}),
    };
  }

  private payments(row: InvoiceRow): StoredPayment[] {
    return JSON.parse(row.payments_json) as StoredPayment[];
  }

  private statusOf(row: InvoiceRow, payments: StoredPayment[]): InvoiceStatus {
    const seen = payments.map((p) => ({ sats: BigInt(p.sats), seenAt: p.seenAt }));
    return invoiceStatus({ requiredSats: BigInt(row.required_sats), expiresAt: row.expires_at, payments: seen }, this.now(), this.o.config.pay);
  }

  /** The invoice with its status recomputed now (and stored when it moved). */
  current(id: string): { row: InvoiceRow; payments: StoredPayment[]; status: InvoiceStatus } | undefined {
    const row = this.store.get(id);
    if (!row) return undefined;
    const payments = this.payments(row);
    const status = this.statusOf(row, payments);
    if (status !== row.status) {
      this.store.update(id, { status });
      row.status = status;
    }
    return { row, payments, status };
  }

  /** The invoice as GET /api/pay/invoice/:id shows it. */
  view(id: string): InvoiceView | undefined {
    const cur = this.current(id);
    if (!cur) return undefined;
    const { row, payments, status } = cur;
    const decimals = this.token.decimals;
    const paid = payments.reduce((s, p) => s + BigInt(p.sats), 0n);
    return {
      id,
      status,
      usd: row.usd,
      address: row.address,
      bip21: bip21(row.address, BigInt(row.required_sats)),
      requiredSats: row.required_sats,
      paidSats: paid.toString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      orderId: row.order_id,
      returnUrl: row.return_url,
      payments: payments.map((p) => ({ txid: p.coin.split(':')[0]!, sats: p.sats })),
      convert: payments
        .filter((p) => p.action === 'converted' && p.finishTxid)
        .map((p) => ({ txid: p.finishTxid!, pusd: (Number(p.tokens ?? '0') / 10 ** decimals).toFixed(decimals) })),
      webhook: { state: row.webhook_state, attempts: row.webhook_attempts },
    };
  }

  /** Landing watcher listener: records the coins seen at an invoice address and what the finisher did with them. */
  observe(landing: LandingRow, results: FinishResult[]): void {
    const row = this.store.byAddress(landing.address);
    if (!row) return;
    const payments = this.payments(row);
    let changed = false;
    for (const r of results) {
      if (r.action === 'skipped') continue;
      let p = payments.find((x) => x.coin === r.coin);
      if (!p) {
        p = { coin: r.coin, sats: r.sats.toString(), seenAt: this.now(), action: 'waiting' };
        payments.push(p);
        changed = true;
      }
      if ((r.action === 'converted' || r.action === 'returned') && p.action !== r.action) {
        p.action = r.action;
        p.finishTxid = r.txid;
        if (r.action === 'converted' && r.tokens !== undefined) p.tokens = r.tokens.toString();
        changed = true;
      }
    }
    if (!changed) return;
    this.store.update(row.id, { payments_json: JSON.stringify(payments), status: this.statusOf(row, payments) });
  }
}
