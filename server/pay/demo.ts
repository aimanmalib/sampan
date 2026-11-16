// The demo shop's own webhook receiver (POST /api/pay/demo-hook). The demo order is made by the server with a
// webhook to this route, signed with SAMPAN_PAY_DEMO_SECRET (host only, never in the repository). An order is shown
// as fulfilled only after this route checked the signature and the timestamp, as a merchant's server would.
// POST /api/pay/demo/order is the shop's checkout (one product at pay.demo.priceUsd, paid to the test wallet);
// GET /api/pay/demo/order/:id tells the status page whether the shop has handed the order over.
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { SampanConfig } from '../../core/config.js';
import { DEMO_ORDER_PREFIX } from '../../core/pay/config.js';
import { ApiError, HOUR, limit, sendError } from '../api/guard.js';
import { HEX_ID } from '../api/wire.js';
import type { Services } from '../services.js';
import { checkWebhook } from './sign.js';

export const DEMO_HOOK_PATH = '/api/pay/demo-hook';

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
    scope.post<{ Body: string }>(DEMO_HOOK_PATH, async (req, reply) => {
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

export interface DemoOrderAnswer {
  id: string;
  statusUrl: string;
}

/** The demo shop's checkout and its order lookup. Both are 404 while features.pay is off or the host has no secret. */
export function registerDemoShop(app: FastifyInstance, config: SampanConfig, s: Services, secret: string | undefined): void {
  const open = (): string => {
    if (!config.features.pay || !secret) throw new ApiError(404, 'not_found', 'not found');
    return secret;
  };

  app.post('/api/pay/demo/order', async (req, reply) => {
    try {
      const key = open();
      limit(s, req, 'invoice', config.rate.invoicesPerHour, HOUR);
      const site = config.site.url;
      const created = await s.pay.create({
        usd: config.pay.demo.priceUsd,
        merchantAddress: config.pay.demo.merchantAddress,
        webhookUrl: `${site}${DEMO_HOOK_PATH}`,
        webhookSecret: key,
        orderId: `${DEMO_ORDER_PREFIX}${randomBytes(6).toString('hex')}`,
        returnUrl: `${site}/pay`,
      });
      s.demoOrders.add(created.id);
      const answer: DemoOrderAnswer = { id: created.id, statusUrl: `/pay/i/${created.id}` };
      return answer;
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.get<{ Params: { id: string } }>(
    '/api/pay/demo/order/:id',
    { schema: { params: { type: 'object', required: ['id'], properties: { id: HEX_ID } } } },
    async (req, reply) => {
      try {
        open();
        const order = s.demoOrders.get(req.params.id);
        if (!order) throw new ApiError(404, 'not_found', 'not a demo order');
        return { fulfilled: order.fulfilled_at !== null, fulfilledAt: order.fulfilled_at === null ? null : new Date(order.fulfilled_at).toISOString() };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
