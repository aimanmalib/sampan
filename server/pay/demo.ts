// The demo shop's own webhook receiver (POST /api/pay/demo-hook). The demo order is made by the server with a
// webhook to this route, signed with SAMPAN_PAY_DEMO_SECRET (host only, never in the repository). An order is shown
// as fulfilled only after this route checked the signature and the timestamp, as a merchant's server would.
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { SampanConfig } from '../../core/config.js';
import { checkWebhook } from './sign.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pay_demo_orders (
  invoice_id TEXT PRIMARY KEY REFERENCES pay_invoices (id),
  created_at INTEGER NOT NULL,
  fulfilled_at INTEGER,
  event TEXT
);
`;

/** Events that mean the merchant received the price (an underpaid order is not handed over). */
const FULFILLING = new Set(['invoice.paid', 'invoice.overpaid', 'invoice.paid_late']);
/** A message older or newer than this is refused (Standard Webhooks recommends five minutes). */
export const DEMO_HOOK_TOLERANCE_SECONDS = 300;

export interface DemoOrder {
  invoice_id: string;
  created_at: number;
  fulfilled_at: number | null;
  event: string | null;
}

export class DemoOrders {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(SCHEMA);
  }

  add(invoiceId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO pay_demo_orders (invoice_id, created_at) VALUES (?, ?)').run(invoiceId, this.now());
  }

  get(invoiceId: string): DemoOrder | undefined {
    return this.db.prepare('SELECT * FROM pay_demo_orders WHERE invoice_id = ?').get(invoiceId) as DemoOrder | undefined;
  }

  /** Marks a known order fulfilled once; false for an order the demo shop never made. */
  fulfil(invoiceId: string, event: string): boolean {
    const r = this.db
      .prepare('UPDATE pay_demo_orders SET fulfilled_at = COALESCE(fulfilled_at, ?), event = COALESCE(event, ?) WHERE invoice_id = ?')
      .run(this.now(), event, invoiceId);
    return r.changes > 0;
  }
}

export function registerDemoHook(app: FastifyInstance, config: SampanConfig, orders: DemoOrders, secret: string | undefined, now: () => number = Date.now): void {
  // The signature covers the exact bytes, so this route reads the body as text (encapsulated: other routes still parse JSON).
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => done(null, body));
    scope.post<{ Body: string }>('/api/pay/demo-hook', async (req, reply) => {
      if (!config.features.pay || !secret) return reply.code(404).send({ error: 'not_found', message: 'not found' });
      const body = typeof req.body === 'string' ? req.body : '';
      const bad = checkWebhook(secret, req.headers, body, Math.floor(now() / 1000), DEMO_HOOK_TOLERANCE_SECONDS);
      if (bad) return reply.code(401).send({ error: 'bad_signature', message: bad });
      let msg: { type?: unknown; data?: { id?: unknown } };
      try {
        msg = JSON.parse(body) as typeof msg;
      } catch {
        return reply.code(400).send({ error: 'bad_request', message: 'body is not JSON' });
      }
      const type = typeof msg.type === 'string' ? msg.type : '';
      const id = typeof msg.data?.id === 'string' ? msg.data.id : '';
      if (!FULFILLING.has(type)) return { ok: true, fulfilled: false };
      if (!orders.fulfil(id, type)) return reply.code(404).send({ error: 'not_found', message: 'unknown demo order' });
      return { ok: true, fulfilled: true };
    });
  });
}
