// POST /api/atom/broadcast: the user's payment to the atomic swap contract (PUSD to USDC), built, checked and signed in
// the page. The server only relays it: open while the atom flag and that flow are on, and only for a transaction that
// passes the libauth VM against the coins it names, pays exactly one token-aware P2SH32 output carrying the route's
// stablecoin, and sends everything else to plain P2PKH outputs (the wallet's change). The server builds nothing here
// and keeps no record; the swap itself is the service's.
import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import type { FastifyInstance } from 'fastify';
import type { SampanConfig } from '../../core/config.js';
import { verifyTransaction } from '../../core/tx/verify.js';
import { waitIndexed } from '../chain/settle.js';
import { BroadcastError } from '../chain/types.js';
import type { Services } from '../services.js';
import { ApiError, crossingLimit, sendError } from './guard.js';
import { outputFromWire, type WireOutput } from './wire.js';

interface Body {
  tx: string;
  sourceOutputs: WireOutput[];
}

const P2SH32 = /^aa20[0-9a-f]{64}87$/;
const P2PKH = /^76a914[0-9a-f]{40}88ac$/;
const HEX = { type: 'string', pattern: '^([0-9a-f]{2}){1,10000}$' } as const;
const OUTPUT = {
  type: 'object',
  required: ['lockingBytecode', 'valueSatoshis'],
  additionalProperties: false,
  properties: {
    lockingBytecode: HEX,
    valueSatoshis: { type: 'string', pattern: '^[0-9]{1,16}$' },
    token: {
      type: 'object',
      required: ['category', 'amount'],
      additionalProperties: false,
      properties: { category: { type: 'string', pattern: '^[0-9a-f]{64}$' }, amount: { type: 'string', pattern: '^[0-9]{1,20}$' } },
    },
  },
} as const;

/** Why this transaction is not a payment to a swap contract, or null when it is one. */
export function contractPaymentProblem(outputs: Array<{ lockingBytecode: Uint8Array; token?: { category: Uint8Array; nft?: unknown } }>, category: string): string | null {
  const contract = outputs.filter((o) => P2SH32.test(binToHex(o.lockingBytecode)));
  if (contract.length !== 1) return 'the transaction must pay exactly one contract output';
  const token = contract[0]!.token;
  if (!token || token.nft || binToHex(token.category) !== category.toLowerCase()) return 'the contract output does not carry the route stablecoin';
  if (outputs.some((o) => !P2SH32.test(binToHex(o.lockingBytecode)) && !P2PKH.test(binToHex(o.lockingBytecode)))) return 'change must go to plain wallet addresses';
  return null;
}

export function registerAtom(app: FastifyInstance, config: SampanConfig, s: Services): void {
  app.post<{ Body: Body }>(
    '/api/atom/broadcast',
    {
      bodyLimit: 200_000,
      schema: {
        body: {
          type: 'object',
          required: ['tx', 'sourceOutputs'],
          additionalProperties: false,
          properties: { tx: { type: 'string', pattern: '^([0-9a-f]{2}){60,100000}$' }, sourceOutputs: { type: 'array', minItems: 1, maxItems: 50, items: OUTPUT } },
        },
      },
    },
    async (req, reply) => {
      try {
        if (!config.features.atom || !config.atom.flows.includes('pusd-to-usdc')) throw new ApiError(404, 'flow_closed', 'this route is not open');
        crossingLimit(s, config, req);
        const tx = decodeTransaction(hexToBin(req.body.tx));
        if (typeof tx === 'string') throw new ApiError(400, 'bad_transaction', 'the transaction could not be read');
        if (tx.inputs.length !== req.body.sourceOutputs.length) throw new ApiError(400, 'bad_transaction', 'one source output is needed for every input');
        const problem = contractPaymentProblem(tx.outputs, config.tokens[config.defaultToken]!.category);
        if (problem) throw new ApiError(400, 'not_contract_payment', problem);
        const sources = req.body.sourceOutputs.map(outputFromWire);
        const vm = verifyTransaction(tx, sources);
        if (!vm.ok) throw new ApiError(400, 'invalid_transaction', 'the signed transaction is not valid; nothing was sent');
        try {
          const txid = await s.chain.broadcast(req.body.tx);
          await waitIndexed(s.chain, txid, tx, { waitMs: config.electrum.indexWaitMs, pollMs: config.electrum.indexPollMs });
          s.scanner.forget([...req.body.sourceOutputs.map((o) => o.lockingBytecode), ...tx.outputs.map((o) => binToHex(o.lockingBytecode))]);
          return { txid };
        } catch (e) {
          if (!(e instanceof BroadcastError)) throw e;
          throw new ApiError(e.staleInputs ? 409 : 400, e.staleInputs ? 'stale_inputs' : 'rejected', 'the network rejected the payment; nothing was sent');
        }
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
