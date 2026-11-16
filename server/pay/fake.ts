// Sampan Pay on the fake network (SAMPAN_FAKE=1, end-to-end tests only). Two routes stand in for a wallet and for
// the clock: one pays an invoice address on the fake chain, one moves an invoice past its expiry. The demo shop's
// webhook is answered in-process by the demo hook of the same server, signed as on the public site, so the test sees
// the order fulfilled only after the signature check. No route here exists unless the server runs on the fake network.
import type { FastifyInstance } from 'fastify';
import { parseAddress } from '../../core/address.js';
import type { SampanConfig } from '../../core/config.js';
import { FakeChain } from '../chain/fake.js';
import type { Services } from '../services.js';
import { DEMO_HOOK_PATH } from './demo.js';
import type { Transport } from './ssrf.js';

/** Fake-network transport: the demo hook of this server in-process, 503 for every other address. */
export function fakeTransport(config: SampanConfig, delivery: Services['fakeDelivery']): Transport {
  const site = new URL(config.site.url).origin;
  return async (target, headers, body) =>
    target.url.origin === site && target.url.pathname === DEMO_HOOK_PATH && delivery.inject ? delivery.inject(DEMO_HOOK_PATH, headers, body) : 503;
}

let coinNo = 0;

export function registerFakePay(app: FastifyInstance, config: SampanConfig, s: Services): void {
  if (!config.features.pay || !(s.chain instanceof FakeChain)) return;
  const chain = s.chain;
  s.fakeDelivery.inject = async (path, headers, body) => (await app.inject({ method: 'POST', url: path, headers: { ...headers, 'content-type': 'application/json' }, payload: body })).statusCode;

  // Pays the invoice address in full, or half of it ("short") to show an underpaid invoice.
  app.post<{ Params: { id: string }; Body: { part?: 'full' | 'short' } }>('/api/pay/fake/pay/:id', async (req, reply) => {
    const row = s.pay.store.get(req.params.id);
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'unknown invoice' });
    const lock = parseAddress(row.address, s.prefix);
    if (typeof lock === 'string') return reply.code(500).send({ error: 'server_error', message: lock });
    const required = BigInt(row.required_sats);
    const sats = req.body?.part === 'short' ? required / 2n : required;
    coinNo += 1;
    chain.add(lock.lockingHex, { txid: coinNo.toString(16).padStart(64, 'c'), vout: 0, sats, height: 0 });
    await s.watcher.kick(row.crossing_id);
    return { ok: true, sats: sats.toString() };
  });

  // Moves the invoice's expiry to now, as if its time had run out.
  app.post<{ Params: { id: string } }>('/api/pay/fake/expire/:id', async (req, reply) => {
    const r = s.db.handle.prepare('UPDATE pay_invoices SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, req.params.id);
    if (r.changes === 0) return reply.code(404).send({ error: 'not_found', message: 'unknown invoice' });
    return { ok: true };
  });
}
