// Landing on the fake network (SAMPAN_FAKE=1, end-to-end tests only): one route stands in for a wallet that is not
// connected to the page, paying a landing address on the fake chain, so a test can watch the page notice a payment
// by itself. No route here exists unless the server runs on the fake network with the landing flow on.
import type { FastifyInstance } from 'fastify';
import { parseAddress } from '../../core/address.js';
import type { SampanConfig } from '../../core/config.js';
import { parseUnits } from '../../core/wallet.js';
import { FakeChain } from '../chain/fake.js';
import type { Services } from '../services.js';

let coinNo = 0;

export function registerFakeLanding(app: FastifyInstance, config: SampanConfig, s: Services): void {
  if (!config.features.landing || !(s.chain instanceof FakeChain)) return;
  const chain = s.chain;
  // Pays the landing address of a crossing the judge amount (limits.judgeLandBch), as a plain wallet would.
  app.post<{ Params: { id: string } }>('/api/landing/fake/pay/:id', async (req, reply) => {
    const row = s.db.landingOf(req.params.id);
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'unknown landing' });
    const lock = parseAddress(row.address, s.prefix);
    if (typeof lock === 'string') return reply.code(500).send({ error: 'server_error', message: lock });
    const sats = parseUnits(config.limits.judgeLandBch, 8);
    if (sats === undefined) return reply.code(500).send({ error: 'server_error', message: 'limits.judgeLandBch' });
    coinNo += 1;
    chain.add(lock.lockingHex, { txid: coinNo.toString(16).padStart(64, 'd'), vout: 0, sats, height: 0 });
    await s.watcher.kick(row.crossing_id);
    return { ok: true, sats: sats.toString() };
  });
}
