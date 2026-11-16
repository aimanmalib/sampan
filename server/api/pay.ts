// Sampan Pay API (docs/decisions/0027-sampan-pay-invoices.md). POST /api/pay/invoice opens an invoice address for a
// merchant; GET /api/pay/invoice/:id reports its status, payments and converts; /qr.svg draws its BIP21 link.
// Every route answers 404 while features.pay is off. No accounts: the id is 128 random bits. These are the only
// routes other sites may call from a browser (CORS in server/security.ts).
import type { FastifyInstance } from 'fastify';
import type { SampanConfig } from '../../core/config.js';
import { qrSvg } from '../../core/qr.js';
import type { ErrorPages } from '../error-page.js';
import type { Services } from '../services.js';
import { ApiError, HOUR, limit, quoteLimit, sendError } from './guard.js';
import { ADDRESS, HEX_ID } from './wire.js';
import type { NewInvoiceRequest } from '../pay/service.js';

const URL_FIELD = { type: 'string', minLength: 9, maxLength: 2000 } as const;

export function payOpen(config: SampanConfig): void {
  if (!config.features.pay) throw new ApiError(404, 'not_found', 'not found');
}

export function registerPay(app: FastifyInstance, config: SampanConfig, s: Services): void {
  app.post<{ Body: NewInvoiceRequest }>(
    '/api/pay/invoice',
    {
      schema: {
        body: {
          type: 'object',
          required: ['usd', 'merchantAddress'],
          additionalProperties: false,
          properties: {
            usd: { type: 'number' },
            merchantAddress: ADDRESS,
            webhookUrl: URL_FIELD,
            webhookSecret: { type: 'string', maxLength: 200 },
            orderId: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,64}$' },
            returnUrl: URL_FIELD,
          },
        },
      },
    },
    async (req, reply) => {
      try {
        payOpen(config);
        limit(s, req, 'invoice', config.rate.invoicesPerHour, HOUR);
        return await s.pay.create(req.body);
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/pay/invoice/:id',
    { schema: { params: { type: 'object', required: ['id'], properties: { id: HEX_ID } } } },
    async (req, reply) => {
      try {
        payOpen(config);
        quoteLimit(s, config, req);
        const view = s.pay.view(req.params.id);
        if (!view) throw new ApiError(404, 'not_found', 'unknown invoice');
        return view;
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/pay/invoice/:id/qr.svg',
    { schema: { params: { type: 'object', required: ['id'], properties: { id: HEX_ID } } } },
    async (req, reply) => {
      try {
        payOpen(config);
        quoteLimit(s, config, req);
        const view = s.pay.view(req.params.id);
        if (!view) throw new ApiError(404, 'not_found', 'unknown invoice');
        return reply.type('image/svg+xml').header('Cache-Control', 'public, max-age=3600').send(qrSvg(view.bip21));
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  // CORS preflight for the JSON POST from a merchant's page.
  app.options('/api/pay/*', async (_req, reply) => {
    if (!config.features.pay) return reply.code(404).send({ error: 'not_found', message: 'not found' });
    return reply.code(204).send();
  });
}

/** The merchant button script and its example page (with its style sheet) are files in web/public; while features.pay is off they are the
 *  same static 404 page as any missing file, so nothing points at a flow that is not open. */
export const PAY_FILES = /^\/pay(\.js|\/[^/]+\.(html|css))(\?|$)/;

export function registerPayFiles(app: FastifyInstance, config: SampanConfig, errorPages: ErrorPages): void {
  if (config.features.pay) return;
  app.addHook('onRequest', async (req, reply) => {
    if (PAY_FILES.test(req.url)) return errorPages.notFound(reply);
  });
}
