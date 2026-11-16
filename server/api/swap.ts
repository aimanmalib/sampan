// POST /api/swap/quote and POST /api/swap/build. Build returns the unsigned transaction with everything the
// page needs to run checkTransaction before the wallet sees it, and records the crossing.
import type { FastifyInstance } from 'fastify';
import { BCH } from '../../core/check.js';
import type { SampanConfig } from '../../core/config.js';
import type { TradeSide } from '../../core/pools/trade.js';
import type { Origin } from '../db.js';
import type { Services } from '../services.js';
import type { BuiltSwap, Quote } from '../swap.js';
import { ApiError, crossingLimit, quoteLimit, sendError } from './guard.js';
import { ADDRESS, AMOUNT, HEX_ID, jsonSafe, outputToWire, txToHex } from './wire.js';

interface QuoteBody {
  token: string;
  side: TradeSide;
  amount: string;
}

interface BuildBody extends QuoteBody {
  minReceive: string;
  addresses: Array<{ address: string; path: string }>;
  payoutAddress: string;
  changeAddress: string;
  /** Rebuild of a crossing whose broadcast found its pool already spent. */
  crossingId?: string;
}

const quoteProps = {
  token: { type: 'string', pattern: '^[A-Z]{2,10}$' },
  side: { type: 'string', enum: ['buy', 'sell'] },
  amount: AMOUNT,
} as const;

const PATH = { type: 'string', pattern: '^(receive|change|defi)/[0-9]{1,6}$' } as const;

export const quoteToWire = (q: Quote): unknown => jsonSafe(q);

/** What the page compares the transaction against (core/check Expectation, amounts as strings). */
export function expectationOf(b: BuiltSwap, feeCapSats: number): unknown {
  const { quote } = b;
  return jsonSafe({
    userLockingBytecodes: b.userLockingBytecodes,
    inputPaths: b.inputPaths,
    poolOwnerPkhs: b.poolOwnerPkhs,
    spend: quote.side === 'buy' ? { sats: quote.supply + quote.sampanFeeSats, tokens: {} } : { sats: 0n, tokens: { [quote.category]: quote.supply } },
    feeCapSats: BigInt(feeCapSats),
    receive: quote.side === 'buy' ? { category: quote.category, min: quote.minReceive } : { category: BCH, min: quote.minReceive },
  });
}

export function registerSwap(app: FastifyInstance, config: SampanConfig, s: Services): void {
  app.post<{ Body: QuoteBody }>(
    '/api/swap/quote',
    { schema: { body: { type: 'object', required: ['token', 'side', 'amount'], additionalProperties: false, properties: quoteProps } } },
    async (req, reply) => {
      try {
        quoteLimit(s, config, req);
        const q = await s.swaps.quote({ token: req.body.token, side: req.body.side, amount: BigInt(req.body.amount) });
        return { quote: quoteToWire(q) };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post<{ Body: BuildBody }>(
    '/api/swap/build',
    {
      schema: {
        body: {
          type: 'object',
          required: ['token', 'side', 'amount', 'minReceive', 'addresses', 'payoutAddress', 'changeAddress'],
          additionalProperties: false,
          properties: {
            ...quoteProps,
            minReceive: AMOUNT,
            addresses: {
              type: 'array',
              minItems: 1,
              maxItems: config.wallet.maxAddressesPerScan,
              items: { type: 'object', required: ['address', 'path'], additionalProperties: false, properties: { address: ADDRESS, path: PATH } },
            },
            payoutAddress: ADDRESS,
            changeAddress: ADDRESS,
            crossingId: HEX_ID,
          },
        },
      },
    },
    async (req, reply) => {
      try {
        quoteLimit(s, config, req);
        const body = req.body;
        const previous = body.crossingId ? s.db.getCrossing(body.crossingId) : undefined;
        if (body.crossingId && (!previous || previous.kind !== 'swap' || previous.status !== 'stale'))
          throw new ApiError(409, 'not_rebuildable', 'this swap cannot be rebuilt; start a new one');
        if (previous && previous.attempts >= config.cauldron.buildAttempts)
          throw new ApiError(409, 'gave_up', 'the pools kept moving; please start a new swap');
        if (!previous) crossingLimit(s, config, req);

        const built = await s.swaps.build({
          token: body.token,
          side: body.side,
          amount: BigInt(body.amount),
          minReceive: BigInt(body.minReceive),
          addresses: body.addresses,
          payoutAddress: body.payoutAddress,
          changeAddress: body.changeAddress,
        });
        const record = {
          tx: txToHex(built.built.transaction),
          sourceOutputs: built.built.sourceOutputs.map(outputToWire),
          quote: quoteToWire(built.quote),
        };
        const origin: Origin = built.userLockingBytecodes.some((l) => s.testLocks.has(l)) ? 'test' : 'public';
        let crossingId: string;
        if (previous) {
          crossingId = previous.id;
          s.db.updateCrossing(crossingId, { status: 'built', quote_json: JSON.stringify(record) });
        } else {
          crossingId = s.db.createCrossing({
            kind: 'swap',
            status: 'built',
            asset: body.token,
            amount: body.amount,
            address: body.payoutAddress,
            origin,
            quote: record,
          });
        }
        return {
          crossingId,
          tx: record.tx,
          sourceOutputs: record.sourceOutputs,
          inputPaths: built.inputPaths,
          feeSats: built.built.feeSats.toString(),
          quote: record.quote,
          expectation: expectationOf(built, config.fees.capSats),
        };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
