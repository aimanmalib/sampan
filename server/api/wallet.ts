// POST /api/wallet/scan: history and coins for addresses the page derived from the wallet's xpubs.
import type { FastifyInstance } from 'fastify';
import type { SampanConfig } from '../../core/config.js';
import type { ScanRequest } from '../scan.js';
import type { Services } from '../services.js';
import { quoteLimit, sendError } from './guard.js';
import { ADDRESS, utxoToWire } from './wire.js';

const list = { type: 'array', items: ADDRESS, maxItems: 200 } as const;

export function registerWallet(app: FastifyInstance, config: SampanConfig, s: Services): void {
  app.post<{ Body: ScanRequest }>(
    '/api/wallet/scan',
    {
      schema: {
        body: {
          type: 'object',
          required: ['paths'],
          additionalProperties: false,
          properties: {
            start: { type: 'integer', minimum: 0, maximum: 100_000 },
            paths: { type: 'object', additionalProperties: false, properties: { receive: list, change: list, defi: list } },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        quoteLimit(s, config, req);
        const res = await s.scanner.scan(req.body);
        const paths = Object.fromEntries(
          Object.entries(res.paths).map(([path, r]) => [
            path,
            { more: r.more, addresses: r.addresses.map((a) => ({ address: a.address, used: a.used, utxos: a.utxos.map(utxoToWire) })) },
          ]),
        );
        return { start: req.body.start ?? 0, gapLimit: config.wallet.gapLimit, paths };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
