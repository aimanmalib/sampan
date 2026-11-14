// GET /api/crossings/:id: what the status page shows. No addresses or quote payloads leave the server here.
import type { FastifyInstance } from 'fastify';
import type { Services } from '../services.js';
import { ApiError, sendError } from './guard.js';

export function registerCrossings(app: FastifyInstance, s: Services): void {
  app.get<{ Params: { id: string } }>(
    '/api/crossings/:id',
    { schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-f]{32}$' } } } } },
    async (req, reply) => {
      try {
        const row = s.db.getCrossing(req.params.id);
        if (!row) throw new ApiError(404, 'not_found', 'unknown crossing');
        return {
          id: row.id,
          kind: row.kind,
          status: row.status,
          asset: row.asset,
          amount: row.amount,
          txid: row.txid,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
