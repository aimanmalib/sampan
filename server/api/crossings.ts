// GET /api/crossings/:id: what the status page shows. POST /api/crossings/:id/kick: try to finish now.
// GET /api/stats: counts for the "Measured" line, split by origin. No owner addresses or quote payloads leave here;
// the recovery card stays in the page's URL fragment.
import type { FastifyInstance } from 'fastify';
import type { SampanConfig } from '../../core/config.js';
import type { Services } from '../services.js';
import { ApiError, quoteLimit, sendError } from './guard.js';

const ID_PARAMS = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-f]{32}$' } } } as const;

const STAGE_STATUS = { done: 'completed', refunded: 'refunded' } as const;

/** A crossing out: ask the route how far it got and keep a final answer on the row. */
async function outStage(s: Services, id: string): Promise<Record<string, unknown> | undefined> {
  const row = s.db.getCrossing(id);
  if (!row?.txid || !s.route) return undefined;
  try {
    const st = await s.route.status(row.txid);
    const final = st.stage === 'done' || st.stage === 'refunded' ? STAGE_STATUS[st.stage] : undefined;
    if (final && row.status !== final) s.db.updateCrossing(id, { status: final });
    return { stage: st.stage, outTxid: st.outTxid ?? null, outChain: st.outChain ?? null };
  } catch {
    return { stage: 'unknown', outTxid: null, outChain: null };
  }
}

async function view(s: Services, id: string): Promise<Record<string, unknown>> {
  const first = s.db.getCrossing(id);
  const out = first?.kind === 'out' || first?.kind === 'in' ? await outStage(s, id) : undefined;
  const row = s.db.getCrossing(id);
  if (!row) throw new ApiError(404, 'not_found', 'unknown crossing');
  const base = {
    id: row.id,
    kind: row.kind,
    status: row.status,
    asset: row.asset,
    amount: row.amount,
    txid: row.txid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.kind === 'out') return { ...base, route: row.route, out: out ?? null };
  if (row.kind === 'in') {
    // The landing address the route pays, when the user asked for the stablecoin (its own status page).
    const landing = row.deposit_address ? s.db.landingByAddress(row.deposit_address) : undefined;
    return { ...base, route: row.route, out: out ?? null, landingId: landing?.crossing_id ?? null };
  }
  if (row.kind !== 'land') return base;
  const l = s.db.landingOf(row.id);
  return {
    ...base,
    landing: {
      address: row.deposit_address,
      paymentTxid: l?.utxo ? l.utxo.split(':')[0] : null,
      seenAt: l?.seen_at ?? null,
      finishedAt: l?.finished_at ?? null,
      watching: l?.status === 'watching',
    },
  };
}

export function registerCrossings(app: FastifyInstance, config: SampanConfig, s: Services): void {
  app.get<{ Params: { id: string } }>('/api/crossings/:id', { schema: { params: ID_PARAMS } }, async (req, reply) => {
    try {
      return await view(s, req.params.id);
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.post<{ Params: { id: string } }>('/api/crossings/:id/kick', { schema: { params: ID_PARAMS } }, async (req, reply) => {
    try {
      quoteLimit(s, config, req);
      const row = s.db.getCrossing(req.params.id);
      if (!row) throw new ApiError(404, 'not_found', 'unknown crossing');
      if (row.kind === 'land') await s.watcher.kick(row.id);
      return await view(s, row.id);
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.get('/api/stats', async () => ({ test: s.db.stats('test'), public: s.db.stats('public') }));
}
