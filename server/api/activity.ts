// POST /api/activity: the crossings made for the addresses of the wallets the page has connected (it sends them; the
// server lists nothing else). GET /api/lookup/:txid: where a pasted transaction id leads, from this server's own
// records first and then THORChain's public tx/status (ADR 0076). Both share the quote rate limit.
import type { FastifyInstance } from 'fastify';
import { addressKey, bareTxid } from '../../core/activity.js';
import type { SampanConfig } from '../../core/config.js';
import type { Services } from '../services.js';
import { ApiError, quoteLimit, sendError } from './guard.js';
import { splitRowAsset } from './wire.js';

const crossingUrl = (id: string): string => `/c/${id}`;

/** The crossing page this server has for the txid, else THORChain's explorer page when THORChain has seen it. */
async function lookup(config: SampanConfig, s: Services, raw: string): Promise<{ url: string }> {
  const bare = bareTxid(raw);
  if (!bare) throw new ApiError(400, 'bad_txid', 'a transaction id is 64 hex digits, with or without 0x');
  const id = s.db.crossingByTxid(bare);
  if (id) return { url: crossingUrl(id) };
  const thor = s.routes.find((r) => r.id === 'thorchain');
  if (thor) {
    const st = await thor.status(bare);
    if (st.stage !== 'unseen') return { url: config.thorchain.explorerTxUrl.replace('{txid}', bare) };
  }
  throw new ApiError(404, 'not_found', 'no crossing or THORChain transaction with this id');
}

export function registerActivity(app: FastifyInstance, config: SampanConfig, s: Services): void {
  const { maxAddresses, maxRows } = config.activity;
  const body = {
    type: 'object',
    required: ['addresses'],
    additionalProperties: false,
    properties: { addresses: { type: 'array', minItems: 1, maxItems: maxAddresses, items: { type: 'string', minLength: 20, maxLength: 120 } } },
  } as const;

  app.post<{ Body: { addresses: string[] } }>('/api/activity', { schema: { body } }, async (req, reply) => {
    try {
      quoteLimit(s, config, req);
      const keys = [...new Set(req.body.addresses.map(addressKey).filter((k): k is string => k !== null))];
      const rows = s.db.crossingsFor(keys, maxRows);
      return {
        crossings: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          status: r.status,
          ...splitRowAsset(r.asset),
          amount: r.amount,
          createdAt: r.created_at,
          url: crossingUrl(r.id),
        })),
      };
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.get<{ Params: { txid: string } }>(
    '/api/lookup/:txid',
    { schema: { params: { type: 'object', required: ['txid'], properties: { txid: { type: 'string', maxLength: 80 } } } } },
    async (req, reply) => {
      try {
        quoteLimit(s, config, req);
        return await lookup(config, s, req.params.txid);
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
