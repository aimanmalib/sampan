// POST /api/out/quote and POST /api/out/build: "Send out" through the active route. Build returns the deposit
// transaction with what the page needs for checkTransaction (rule 6 for THORChain) and records the crossing.
// Both answer 503 while compliance.crossChainEnabled is false: the tab is hidden and nothing is offered.
import type { FastifyInstance } from 'fastify';
import type { SampanConfig } from '../../core/config.js';
import { opReturnHex } from '../../core/routes/memo.js';
import { parseAddress } from '../../core/address.js';
import type { Origin } from '../db.js';
import type { OutService, OutView } from '../out.js';
import { RouteError } from '../routes/types.js';
import type { Services } from '../services.js';
import { crossingLimit, quoteLimit, sendError } from './guard.js';
import { ADDRESS, AMOUNT, jsonSafe, outputToWire, txToHex } from './wire.js';

interface QuoteBody {
  source: string;
  amount: string;
  symbol: string;
  chain: string;
  destination: string;
}

interface BuildBody extends QuoteBody {
  minOut: string;
  addresses: Array<{ address: string; path: string }>;
  fromTxid?: string;
}

const quoteProps = {
  source: { type: 'string', pattern: '^[A-Z]{2,10}$' },
  amount: AMOUNT,
  symbol: { type: 'string', pattern: '^[A-Z]{2,10}$' },
  chain: { type: 'string', pattern: '^[A-Z]{2,10}$' },
  destination: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
} as const;
const PATH = { type: 'string', pattern: '^(receive|change|defi)/[0-9]{1,6}$' } as const;

/** The quote as the page shows it: amounts as decimal strings, no raw provider payload. */
export const outViewToWire = (v: OutView): unknown =>
  jsonSafe({
    source: v.source,
    amount: v.amount,
    usd: v.usd,
    ...(v.swap ? { swap: v.swap } : {}),
    route: v.quote.route,
    sats: v.quote.sats,
    vault: v.quote.vault,
    memo: v.quote.memo,
    asset: v.quote.asset,
    destination: v.quote.destination,
    expectedOut: v.quote.expectedOut,
    minOut: v.quote.minOut,
    outDecimals: v.quote.outDecimals,
    fees: v.quote.fees,
    expiry: v.quote.expiry,
    seconds: v.quote.seconds,
  });

function service(config: SampanConfig, s: Services): OutService {
  if (!config.compliance.crossChainEnabled || !s.outs) throw new RouteError('route_paused', 'crossings to other chains are paused');
  return s.outs;
}

export function registerOut(app: FastifyInstance, config: SampanConfig, s: Services): void {
  app.post<{ Body: QuoteBody }>(
    '/api/out/quote',
    { schema: { body: { type: 'object', required: Object.keys(quoteProps), additionalProperties: false, properties: quoteProps } } },
    async (req, reply) => {
      try {
        const outs = service(config, s);
        quoteLimit(s, config, req);
        const b = req.body;
        const view = await outs.quote({ ...b, amount: BigInt(b.amount) });
        return { quote: outViewToWire(view) };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post<{ Body: BuildBody }>(
    '/api/out/build',
    {
      schema: {
        body: {
          type: 'object',
          required: [...Object.keys(quoteProps), 'minOut', 'addresses'],
          additionalProperties: false,
          properties: {
            ...quoteProps,
            minOut: AMOUNT,
            addresses: {
              type: 'array',
              minItems: 1,
              maxItems: config.wallet.maxAddressesPerScan,
              items: { type: 'object', required: ['address', 'path'], additionalProperties: false, properties: { address: ADDRESS, path: PATH } },
            },
            fromTxid: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const outs = service(config, s);
        quoteLimit(s, config, req);
        crossingLimit(s, config, req);
        const b = req.body;
        const built = await outs.build({ ...b, amount: BigInt(b.amount), minOut: BigInt(b.minOut) });
        const { view, payment } = built;
        const vault = parseAddress(view.quote.vault, s.prefix);
        if (typeof vault === 'string') throw new RouteError('route_unavailable', 'the vault address is not usable');
        const record = { tx: txToHex(payment.transaction), sourceOutputs: payment.sourceOutputs.map(outputToWire), quote: outViewToWire(view) };
        const origin: Origin = built.userLocks.some((l) => s.testLocks.has(l)) ? 'test' : 'public';
        const crossingId = s.db.createCrossing({
          kind: 'out',
          status: 'built',
          asset: b.symbol,
          amount: view.quote.sats.toString(),
          address: b.destination,
          depositAddress: view.quote.vault,
          route: view.quote.route,
          origin,
          quote: record,
        });
        return {
          crossingId,
          tx: record.tx,
          sourceOutputs: record.sourceOutputs,
          inputPaths: payment.inputPaths,
          feeSats: payment.feeSats.toString(),
          quote: record.quote,
          deposit: { lockingBytecode: vault.lockingHex, sats: view.quote.sats.toString(), opReturn: opReturnHex(view.quote.memo) },
        };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
