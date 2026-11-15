// POST /api/land/open and POST /api/land/pay/build (flow L). Open returns the recovery card; the page recomputes the
// address from the card's parameters with core/landing and refuses it when the two differ. Pay/build returns a plain
// payment to the landing address for a connected wallet, checked in the page like a swap.
import type { FastifyInstance } from 'fastify';
import type { SampanConfig } from '../../core/config.js';
import type { Services } from '../services.js';
import { ApiError, crossingLimit, quoteLimit, sendError } from './guard.js';
import { ADDRESS, AMOUNT, HEX_ID, jsonSafe, outputToWire, txToHex } from './wire.js';

interface OpenBody {
  ownerAddress: string;
  token: string;
}

interface PayBody {
  crossingId: string;
  amount: string;
  addresses: Array<{ address: string; path: string }>;
  changeAddress: string;
}

const PATH = { type: 'string', pattern: '^(receive|change|defi)/[0-9]{1,6}$' } as const;

export function flowOpen(config: SampanConfig): void {
  if (!config.features.landing) throw new ApiError(404, 'flow_closed', 'landing addresses are not open yet');
}

export function registerLanding(app: FastifyInstance, config: SampanConfig, s: Services): void {
  app.post<{ Body: OpenBody }>(
    '/api/land/open',
    {
      schema: {
        body: {
          type: 'object',
          required: ['ownerAddress', 'token'],
          additionalProperties: false,
          properties: { ownerAddress: ADDRESS, token: { type: 'string', pattern: '^[A-Z]{2,10}$' } },
        },
      },
    },
    async (req, reply) => {
      try {
        flowOpen(config);
        quoteLimit(s, config, req);
        crossingLimit(s, config, req);
        const opened = await s.landings.open(req.body);
        void s.watcher.kick(opened.crossingId);
        return jsonSafe({
          crossingId: opened.crossingId,
          card: opened.card,
          minSats: opened.minSats,
          tokensMin: opened.tokensMin,
          validHours: config.landing.validHours,
        });
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post<{ Body: PayBody }>(
    '/api/land/pay/build',
    {
      schema: {
        body: {
          type: 'object',
          required: ['crossingId', 'amount', 'addresses', 'changeAddress'],
          additionalProperties: false,
          properties: {
            crossingId: HEX_ID,
            amount: AMOUNT,
            addresses: {
              type: 'array',
              minItems: 1,
              maxItems: config.wallet.maxAddressesPerScan,
              items: { type: 'object', required: ['address', 'path'], additionalProperties: false, properties: { address: ADDRESS, path: PATH } },
            },
            changeAddress: ADDRESS,
          },
        },
      },
    },
    async (req, reply) => {
      try {
        flowOpen(config);
        quoteLimit(s, config, req);
        const row = s.db.getCrossing(req.body.crossingId);
        if (!row || row.kind !== 'land') throw new ApiError(404, 'not_found', 'unknown landing address');
        const sats = BigInt(req.body.amount);
        const { payment, landingLockHex, userLocks } = await s.landings.buildPayment({ ...req.body, sats });
        const record = { tx: txToHex(payment.transaction), sourceOutputs: payment.sourceOutputs.map(outputToWire) };
        s.db.updateCrossing(row.id, { quote_json: JSON.stringify(record) });
        return {
          crossingId: row.id,
          tx: record.tx,
          sourceOutputs: record.sourceOutputs,
          inputPaths: payment.inputPaths,
          feeSats: payment.feeSats.toString(),
          expectation: jsonSafe({
            userLockingBytecodes: userLocks,
            inputPaths: payment.inputPaths,
            poolOwnerPkhs: [],
            deposits: [{ lockingBytecode: landingLockHex, sats }],
            spend: { sats, tokens: {} },
            feeCapSats: BigInt(config.fees.capSats),
            receive: { category: config.tokens[row.asset]?.category.toLowerCase() ?? '', min: 0n },
          }),
        };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
