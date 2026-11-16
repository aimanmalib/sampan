// Webhook delivery for Sampan Pay (Standard Webhooks). One event per invoice and status ("invoice.paid", ...),
// queued in SQLite so a restart picks up where it stopped. Every attempt of an event carries the same webhook-id
// (the merchant can drop repeats) and a fresh timestamp and signature. Before the first send the finishing
// transactions are read back from the network (onchain.ts); the target is checked against private addresses when
// the invoice is made and again before every attempt (ssrf.ts). Waits between attempts: pay.webhook.retrySeconds.
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { parseAddress, type CashPrefix } from '../../core/address.js';
import type { SampanConfig } from '../../core/config.js';
import { isSettled } from '../../core/pay/status.js';
import type { Chain } from '../chain/types.js';
import { verifyOnchain } from './onchain.js';
import type { PayService } from './service.js';
import { webhookHeaders } from './sign.js';
import { webhookTarget, type Lookup, type Transport } from './ssrf.js';
import type { InvoiceRow } from './store.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pay_webhooks (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES pay_invoices (id),
  type TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (invoice_id, type)
);
CREATE INDEX IF NOT EXISTS pay_webhooks_due ON pay_webhooks (state, next_at);
`;

export interface WebhookEvent {
  id: string;
  invoice_id: string;
  type: string;
  body: string | null;
  state: 'pending' | 'delivered' | 'failed';
  attempts: number;
  next_at: number;
  last_error: string | null;
}

export interface DispatcherOptions {
  config: SampanConfig;
  db: DatabaseSync;
  pay: PayService;
  chain: Chain;
  prefix: CashPrefix;
  lookup: Lookup;
  transport: Transport;
  now?: () => number;
  log?: ((message: string) => void) | undefined;
}

/** Events handled per tick, so one slow merchant cannot hold up the rest for long. */
const PER_TICK = 20;

export class WebhookDispatcher {
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(private readonly o: DispatcherOptions) {
    this.now = o.now ?? ((): number => Date.now());
    o.db.exec(SCHEMA);
  }

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), this.o.config.pay.webhook.tickSeconds * 1000);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  events(invoiceId: string): WebhookEvent[] {
    return this.o.db.prepare('SELECT * FROM pay_webhooks WHERE invoice_id = ? ORDER BY created_at').all(invoiceId) as unknown as WebhookEvent[];
  }

  /** One pass: queue events for invoices that reached a settled status, then attempt what is due. */
  tick(): Promise<void> {
    this.running ??= this.pass().finally(() => (this.running = undefined));
    return this.running;
  }

  private async pass(): Promise<void> {
    this.enqueueSettled();
    const due = this.o.db
      .prepare(`SELECT * FROM pay_webhooks WHERE state = 'pending' AND next_at <= ? ORDER BY next_at LIMIT ${PER_TICK}`)
      .all(this.now()) as unknown as WebhookEvent[];
    for (const e of due) {
      try {
        await this.attempt(e);
      } catch (err) {
        this.o.log?.(`webhook ${e.id}: ${err instanceof Error ? err.message : String(err)}`);
        this.later(e, 'the network could not be read; trying again');
      }
    }
  }

  /** Invoices with a webhook whose current status has no event yet. */
  private enqueueSettled(): void {
    const rows = this.o.db
      .prepare(
        `SELECT i.id FROM pay_invoices i WHERE i.webhook_url IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM pay_webhooks w WHERE w.invoice_id = i.id AND w.type = 'invoice.' || i.status)`,
      )
      .all() as Array<{ id: string }>;
    const t = this.now();
    for (const { id } of rows) {
      const cur = this.o.pay.current(id);
      if (!cur || !isSettled(cur.status, t, cur.row.expires_at)) continue;
      const added = this.o.db
        .prepare(
          `INSERT OR IGNORE INTO pay_webhooks (id, invoice_id, type, state, next_at, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(`msg_${randomBytes(16).toString('hex')}`, id, `invoice.${cur.status}`, t, t, t);
      if (added.changes > 0) this.o.pay.store.update(id, { webhook_state: 'pending', webhook_attempts: 0 });
    }
  }

  private set(e: WebhookEvent, patch: Partial<Pick<WebhookEvent, 'body' | 'state' | 'attempts' | 'next_at' | 'last_error'>>): void {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    this.o.db.prepare(`UPDATE pay_webhooks SET ${sets}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => patch[k] ?? null), this.now(), e.id);
    Object.assign(e, patch);
  }

  /** Not ready yet (a convert still on its way): look again next tick without counting an attempt. */
  private later(e: WebhookEvent, why: string): void {
    this.set(e, { next_at: this.now() + this.o.config.pay.webhook.tickSeconds * 1000, last_error: why });
  }

  private failed(e: WebhookEvent, why: string): void {
    const waits = this.o.config.pay.webhook.retrySeconds;
    const attempts = e.attempts + 1;
    const out = attempts > waits.length;
    this.set(e, { attempts, last_error: why, state: out ? 'failed' : 'pending', next_at: out ? e.next_at : this.now() + waits[attempts - 1]! * 1000 });
    this.o.pay.store.update(e.invoice_id, { webhook_state: out ? 'failed' : 'pending', webhook_attempts: attempts });
  }

  /** The body is written once, after the network confirmed the payments, and sent unchanged on every attempt. */
  private async body(e: WebhookEvent, row: InvoiceRow): Promise<string | 'wait' | { error: string }> {
    if (e.body) return e.body;
    const { config, chain, prefix } = this.o;
    const cur = this.o.pay.current(row.id)!;
    const lock = parseAddress(row.address, prefix);
    if (typeof lock === 'string') return { error: lock };
    const verdict = await verifyOnchain(chain, row, cur.payments, {
      category: config.tokens[config.defaultToken]!.category.toLowerCase(),
      confirmations: config.pay.confirmations,
      invoiceLock: lock.lockingHex,
      waitingIsFinal: e.type === 'invoice.underpaid',
    });
    if (verdict === 'wait') return 'wait';
    if (verdict !== 'ok') return { error: verdict };
    const data: Record<string, unknown> = { ...this.o.pay.view(row.id)!, status: e.type.slice('invoice.'.length) };
    delete data.webhook; // the delivery state is not part of the event
    const body = JSON.stringify({ type: e.type, timestamp: new Date(this.now()).toISOString(), data });
    this.set(e, { body });
    return body;
  }

  private async attempt(e: WebhookEvent): Promise<void> {
    const row = this.o.pay.store.get(e.invoice_id);
    if (!row?.webhook_url || !row.webhook_secret) return this.set(e, { state: 'failed', last_error: 'invoice has no webhook' });
    const body = await this.body(e, row);
    if (body === 'wait') return this.later(e, 'waiting for the convert');
    if (typeof body !== 'string') return this.failed(e, body.error);
    const { webhook } = this.o.config.pay;
    const target = await webhookTarget(row.webhook_url, { allowPrivate: webhook.allowPrivate, lookup: this.o.lookup });
    if (typeof target === 'string') return this.failed(e, target);
    const headers = webhookHeaders(row.webhook_secret, e.id, Math.floor(this.now() / 1000), body);
    let status: number;
    try {
      status = await this.o.transport(target, { ...headers }, body, webhook.timeoutMs);
    } catch (err) {
      return this.failed(e, err instanceof Error ? err.message : String(err));
    }
    if (status < 200 || status > 299) return this.failed(e, `HTTP ${status}`);
    this.set(e, { state: 'delivered', attempts: e.attempts + 1, last_error: null });
    this.o.pay.store.update(e.invoice_id, { webhook_state: 'delivered', webhook_attempts: e.attempts });
  }
}
