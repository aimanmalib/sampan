// POST /api/broadcast: a signed transaction for a crossing built here. The transaction must spend exactly the
// inputs that were built and pass the libauth VM against the recorded source outputs before it is sent.
import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import type { FastifyInstance } from 'fastify';
import type { SampanConfig } from '../../core/config.js';
import { verifyTransaction } from '../../core/tx/verify.js';
import { BroadcastError } from '../chain/types.js';
import type { Services } from '../services.js';
import { ApiError, quoteLimit, sendError } from './guard.js';
import { HEX_ID, outputFromWire, type WireOutput } from './wire.js';

interface Body {
  crossingId: string;
  tx: string;
}

const outpoints = (hex: string): string[] | string => {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') return tx;
  return tx.inputs.map((i) => `${binToHex(i.outpointTransactionHash)}:${i.outpointIndex}`);
};

export function registerBroadcast(app: FastifyInstance, config: SampanConfig, s: Services): void {
  app.post<{ Body: Body }>(
    '/api/broadcast',
    {
      bodyLimit: 200_000,
      schema: {
        body: {
          type: 'object',
          required: ['crossingId', 'tx'],
          additionalProperties: false,
          properties: { crossingId: HEX_ID, tx: { type: 'string', pattern: '^([0-9a-f]{2}){60,100000}$' } },
        },
      },
    },
    async (req, reply) => {
      try {
        quoteLimit(s, config, req);
        const row = s.db.getCrossing(req.body.crossingId);
        if (!row) throw new ApiError(404, 'not_found', 'unknown crossing');
        if (row.status !== 'built' || !row.quote_json) throw new ApiError(409, 'not_broadcastable', 'this transaction is no longer waiting to be sent');
        const record = JSON.parse(row.quote_json) as { tx: string; sourceOutputs: WireOutput[] };
        const tx = decodeTransaction(hexToBin(req.body.tx));
        if (typeof tx === 'string') throw new ApiError(400, 'bad_transaction', 'the transaction could not be read');
        const built = outpoints(record.tx);
        const signed = outpoints(req.body.tx);
        if (typeof built === 'string' || typeof signed === 'string' || built.join() !== signed.join())
          throw new ApiError(400, 'inputs_changed', 'the signed transaction spends different coins than the one built');
        const vm = verifyTransaction(tx, record.sourceOutputs.map(outputFromWire));
        if (!vm.ok) {
          s.db.updateCrossing(row.id, { error: vm.error.slice(0, 500) });
          throw new ApiError(400, 'invalid_transaction', 'the signed transaction is not valid; nothing was sent');
        }
        try {
          const txid = await s.chain.broadcast(req.body.tx);
          s.db.updateCrossing(row.id, { status: 'broadcast', txid, error: null });
          s.scanner.forget([...record.sourceOutputs.map((o) => o.lockingBytecode), ...tx.outputs.map((o) => binToHex(o.lockingBytecode))]);
          return { crossingId: row.id, txid };
        } catch (e) {
          if (!(e instanceof BroadcastError)) throw e;
          if (e.staleInputs) {
            s.db.updateCrossing(row.id, { status: 'stale', attempts: row.attempts + 1, error: e.message.slice(0, 500) });
            throw new ApiError(409, 'stale_inputs', 'a pool was used by someone else first; rebuild and sign again');
          }
          s.db.updateCrossing(row.id, { status: 'failed', error: e.message.slice(0, 500) });
          throw new ApiError(400, 'rejected', 'the network rejected the transaction; nothing was sent');
        }
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
