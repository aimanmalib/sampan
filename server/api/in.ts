// POST /api/in/quote, POST /api/in/plan, POST /api/in/:id/sent: "Bring in" from another chain through the active
// route. The plan is what the page's EVM wallet signs (router, vault, memo, expiry); the page checks it and, for a
// landing address, recomputes the address before asking the wallet. The server only records the source tx hash.
// All answer 503 while compliance.crossChainEnabled is false.
import type { FastifyInstance } from 'fastify';
import type { SampanConfig } from '../../core/config.js';
import { parseAddress } from '../../core/address.js';
import type { Origin } from '../db.js';
import type { InService, InView } from '../in.js';
import { RouteError } from '../routes/types.js';
import type { Services } from '../services.js';
import { ApiError, crossingGate, crossingLimit, quoteLimit, sendError } from './guard.js';
import { ADDRESS, AMOUNT, HEX_ID, jsonSafe, rowAsset } from './wire.js';

interface QuoteBody {
  symbol: string;
  chain: string;
  amount: string;
  receive: string;
  address: string;
}

const SYMBOL = { type: 'string', pattern: '^[A-Z]{2,10}$' } as const;
const quoteProps = { symbol: SYMBOL, chain: SYMBOL, amount: AMOUNT, receive: SYMBOL, address: ADDRESS } as const;

const inViewToWire = (v: InView): unknown =>
  jsonSafe({
    route: v.quote.route,
    asset: v.quote.asset,
    amount: v.quote.amount,
    destination: v.quote.destination,
    expectedSats: v.quote.expectedSats,
    minSats: v.quote.minSats,
    router: v.quote.router,
    fees: v.quote.fees,
    expiry: v.quote.expiry,
    seconds: v.quote.seconds,
    usd: v.usd,
    ...(v.convert ? { convert: v.convert } : {}),
    gasAssetUsdE8: v.gasAssetUsdE8,
  });

function service(config: SampanConfig, s: Services): InService {
  if (!config.compliance.crossChainEnabled || !s.ins) throw new RouteError('route_paused', 'crossings from other chains are paused');
  return s.ins;
}

const read = (b: QuoteBody) => ({ ...b, amount: BigInt(b.amount) });

export function registerIn(app: FastifyInstance, config: SampanConfig, s: Services): void {
  const required = Object.keys(quoteProps);
  app.post<{ Body: QuoteBody }>(
    '/api/in/quote',
    { schema: { body: { type: 'object', required, additionalProperties: false, properties: quoteProps } } },
    async (req, reply) => {
      try {
        const ins = service(config, s);
        crossingGate(s, config, req);
        quoteLimit(s, config, req);
        return { quote: inViewToWire(await ins.quote(read(req.body))) };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post<{ Body: QuoteBody & { minSats: string } }>(
    '/api/in/plan',
    {
      schema: {
        body: { type: 'object', required: [...required, 'minSats'], additionalProperties: false, properties: { ...quoteProps, minSats: AMOUNT } },
      },
    },
    async (req, reply) => {
      try {
        const ins = service(config, s);
        crossingGate(s, config, req);
        quoteLimit(s, config, req);
        crossingLimit(s, config, req);
        const b = req.body;
        const plan = await ins.plan({ ...read(b), minSats: BigInt(b.minSats) });
        const owner = parseAddress(b.address, s.prefix);
        const origin: Origin = typeof owner !== 'string' && s.testLocks.has(owner.lockingHex) ? 'test' : 'public';
        const quote = inViewToWire(plan);
        const crossingId = s.db.createCrossing({
          kind: 'in',
          status: 'planned',
          asset: rowAsset(b.chain, b.symbol),
          amount: b.amount,
          address: b.address,
          depositAddress: plan.landing?.card.address ?? b.address,
          route: plan.quote.route,
          origin,
          quote: { quote, landing: plan.landing?.crossingId ?? null },
        });
        if (plan.landing) void s.watcher.kick(plan.landing.crossingId);
        const q = plan.quote;
        return jsonSafe({
          crossingId,
          quote,
          deposit: { router: q.router, vault: q.vault, token: plan.token, amount: q.amount, memo: q.memo, expiry: q.expiry },
          ...(plan.landing ? { landing: plan.landing } : {}),
        });
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { txHash: string } }>(
    '/api/in/:id/sent',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: HEX_ID } },
        body: { type: 'object', required: ['txHash'], additionalProperties: false, properties: { txHash: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' } } },
      },
    },
    async (req, reply) => {
      try {
        service(config, s);
        quoteLimit(s, config, req);
        const row = s.db.getCrossing(req.params.id);
        if (!row || row.kind !== 'in') throw new ApiError(404, 'not_found', 'unknown crossing');
        if (row.txid) throw new ApiError(409, 'already_sent', 'this crossing already has its transaction');
        // THORChain names EVM transactions in upper-case hex without 0x.
        s.db.updateCrossing(row.id, { status: 'sent', txid: req.body.txHash.slice(2).toUpperCase() });
        return { ok: true };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
