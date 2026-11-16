// Sampan Pay invoices in the same SQLite file as the crossings. Added with CREATE TABLE IF NOT EXISTS only: no
// existing table is rebuilt. An invoice points at its landing (crossings + landings rows) and keeps the payments
// the landing finisher reported, so its status can be recomputed at any time (core/pay/status.ts).
import type { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pay_invoices (
  id TEXT PRIMARY KEY,
  crossing_id TEXT NOT NULL REFERENCES crossings (id),
  address TEXT NOT NULL UNIQUE,
  merchant_address TEXT NOT NULL,
  merchant_lock TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  usd TEXT NOT NULL,
  tokens TEXT NOT NULL,
  required_sats TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  order_id TEXT,
  return_url TEXT,
  webhook_url TEXT,
  webhook_secret TEXT,
  webhook_state TEXT NOT NULL,
  webhook_attempts INTEGER NOT NULL DEFAULT 0,
  payments_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pay_invoices_merchant ON pay_invoices (merchant_lock, status);
`;

/** Statuses an invoice can still leave by being paid (its nonce stays reserved while it is not expired). */
export const OPEN_STATUSES = ['open', 'underpaid'] as const;

export type WebhookState = 'none' | 'pending' | 'delivered' | 'failed';

/** One coin seen at an invoice address, as the landing finisher reported it. */
export interface StoredPayment {
  coin: string;
  sats: string;
  seenAt: number;
  action: 'converted' | 'returned' | 'waiting';
  /** Convert or giveBack transaction. */
  finishTxid?: string;
  /** Token base units the merchant received (converted only). */
  tokens?: string;
}

export interface InvoiceRow {
  id: string;
  crossing_id: string;
  address: string;
  merchant_address: string;
  merchant_lock: string;
  nonce: number;
  usd: string;
  tokens: string;
  required_sats: string;
  status: string;
  expires_at: number;
  order_id: string | null;
  return_url: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_state: WebhookState;
  webhook_attempts: number;
  payments_json: string;
  created_at: number;
  updated_at: number;
}

export type NewInvoice = Omit<InvoiceRow, 'webhook_attempts' | 'payments_json' | 'created_at' | 'updated_at'>;

export class PayStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(SCHEMA);
  }

  create(i: NewInvoice): void {
    const t = this.now();
    this.db
      .prepare(
        `INSERT INTO pay_invoices (id, crossing_id, address, merchant_address, merchant_lock, nonce, usd, tokens, required_sats, status,
           expires_at, order_id, return_url, webhook_url, webhook_secret, webhook_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        i.id,
        i.crossing_id,
        i.address,
        i.merchant_address,
        i.merchant_lock,
        i.nonce,
        i.usd,
        i.tokens,
        i.required_sats,
        i.status,
        i.expires_at,
        i.order_id,
        i.return_url,
        i.webhook_url,
        i.webhook_secret,
        i.webhook_state,
        t,
        t,
      );
  }

  get(id: string): InvoiceRow | undefined {
    return this.db.prepare('SELECT * FROM pay_invoices WHERE id = ?').get(id) as InvoiceRow | undefined;
  }

  byAddress(address: string): InvoiceRow | undefined {
    return this.db.prepare('SELECT * FROM pay_invoices WHERE address = ?').get(address) as InvoiceRow | undefined;
  }

  /** Nonces of the merchant's invoices that are still open at `now`. */
  openNonces(merchantLock: string, now: number): Set<number> {
    const marks = OPEN_STATUSES.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT nonce FROM pay_invoices WHERE merchant_lock = ? AND status IN (${marks}) AND expires_at > ?`)
      .all(merchantLock, ...OPEN_STATUSES, now) as Array<{ nonce: number }>;
    return new Set(rows.map((r) => r.nonce));
  }

  update(id: string, patch: Partial<Pick<InvoiceRow, 'status' | 'payments_json' | 'webhook_state' | 'webhook_attempts'>>): void {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => patch[k] ?? null);
    this.db.prepare(`UPDATE pay_invoices SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, this.now(), id);
  }
}
