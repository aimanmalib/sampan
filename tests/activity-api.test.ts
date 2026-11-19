// "My activity" and "find a transaction" through the API on the fake network and the fake THORNode (ADR 0076):
// a txid must be 64 hex digits, this server's records answer first, THORChain's tx/status next, and only the
// addresses the page sends are listed.
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { activityState, addressKey, bareTxid } from '../core/activity.js';
import { normalizeConfig, patchConfig, validateConfig, type SampanConfig } from '../core/config.js';
import { buildApp } from '../server/app.js';
import { createServices, type Services } from '../server/services.js';
import { otherAddress, userAddress, userTokenAddress } from './helpers/wallet.js';

const base = patchConfig(normalizeConfig(shipped as unknown as SampanConfig), JSON.stringify({ rate: { quotesPerMinute: 1000 } }));
const EVM = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const SEEN = 'ab'.repeat(32);
const UNSEEN = `${'cd'.repeat(31)}00`;
let app: FastifyInstance | undefined;
let services: Services;
let dist: string | undefined;

const start = async (c: SampanConfig = base) => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-activity-'));
  services = createServices({ config: c, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config: c, webDist: dist, fake: true, services, startWatcher: false });
  return app;
};
afterEach(async () => {
  await app?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
  app = undefined;
});

const get = (url: string) => app!.inject({ method: 'GET', url });
const activity = (addresses: unknown) => app!.inject({ method: 'POST', url: '/api/activity', payload: { addresses } as Record<string, unknown> });
// A status the server really writes once the user has signed (core/activity ACTIVITY_STATES).
const SIGNED = { swap: 'broadcast', land: 'open', out: 'broadcast', in: 'sent' } as const;
const row = (kind: 'swap' | 'land' | 'out' | 'in', address: string, txid?: string, status: string = SIGNED[kind]) => {
  const id = services.db.createCrossing({ kind, status, asset: kind === 'out' || kind === 'in' ? 'BASE.USDC' : 'PUSD', amount: '1000', address, origin: 'public' });
  if (txid) services.db.updateCrossing(id, { txid });
  return id;
};

describe('core/activity', () => {
  it('takes a full txid with or without 0x and refuses anything shorter or not hex', () => {
    expect(bareTxid(` 0x${SEEN.toUpperCase()} `)).toBe(SEEN);
    expect(bareTxid(SEEN.slice(2))).toBeNull();
    expect(bareTxid(`${SEEN.slice(1)}g`)).toBeNull();
  });
  it('matches EVM addresses in any case and CashAddr with or without its prefix', () => {
    expect(addressKey(EVM)).toBe(EVM.toLowerCase());
    expect(addressKey(userAddress)).toBe(userAddress.split(':')[1]);
    expect(addressKey(userAddress.split(':')[1]!)).toBe(userAddress.split(':')[1]);
    expect(addressKey('not an address')).toBeNull();
  });
  it('validates config activity', () => {
    expect(validateConfig(base)).toEqual([]);
    expect(validateConfig({ ...base, activity: { maxAddresses: 0, maxRows: 500 } })).toEqual(
      expect.arrayContaining(['activity.maxAddresses: an integer from 1 to 500', 'activity.maxRows: an integer from 1 to 200']),
    );
  });
});

describe('GET /api/lookup/:txid', () => {
  it('answers 400 bad_txid for an id that is not 64 hex digits', async () => {
    await start();
    for (const bad of ['abc', SEEN.slice(1), `${SEEN.slice(1)}z`]) {
      const res = await get(`/api/lookup/${bad}`);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'bad_txid' });
    }
  });

  it("finds this server's crossing first, by its own txid in any case and with 0x", async () => {
    await start();
    const id = row('in', userAddress, `0x${UNSEEN}`);
    const res = await get(`/api/lookup/${UNSEEN.toUpperCase()}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: `/c/${id}` });
  });

  it('finds a landing by the transaction that paid it', async () => {
    await start();
    const id = row('land', userTokenAddress);
    services.db.createLanding({ address: 'bitcoincash:pexample', crossingId: id, card: {} });
    services.db.updateLanding('bitcoincash:pexample', { utxo: `${UNSEEN}:0` });
    expect((await get(`/api/lookup/0x${UNSEEN}`)).json()).toEqual({ url: `/c/${id}` });
  });

  it("answers with THORChain's explorer page when THORChain has seen a txid this server has not", async () => {
    await start();
    const res = await get(`/api/lookup/${SEEN}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: base.thorchain.explorerTxUrl.replace('{txid}', SEEN) });
  });

  it('answers 404 not_found when neither this server nor THORChain knows the txid', async () => {
    await start();
    const res = await get(`/api/lookup/${UNSEEN}`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found' });
  });

  it('shares the quote rate limit', async () => {
    await start(patchConfig(base, JSON.stringify({ rate: { quotesPerMinute: 2 } })));
    expect((await get(`/api/lookup/${UNSEEN}`)).statusCode).toBe(404);
    expect((await get(`/api/lookup/${UNSEEN}`)).statusCode).toBe(404);
    const third = await get(`/api/lookup/${UNSEEN}`);
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({ error: 'rate_limited' });
  });
});

describe('POST /api/activity', () => {
  it('lists only the crossings of the addresses sent, newest first, with a link to each', async () => {
    await start();
    const swap = row('swap', userAddress);
    const out = row('out', EVM);
    row('swap', otherAddress);
    const res = await activity([userAddress.split(':')[1], EVM.toLowerCase()]);
    expect(res.statusCode).toBe(200);
    const list = res.json().crossings as Array<{ id: string; url: string; kind: string; chain: string | null }>;
    expect(list.map((c) => c.id).sort()).toEqual([swap, out].sort());
    expect(list.find((c) => c.id === out)).toMatchObject({ kind: 'out', chain: 'BASE', url: `/c/${out}` });
    expect(JSON.stringify(list)).not.toContain(EVM.toLowerCase());
  });

  it('leaves out quotes built or planned but never signed, and lists a sent crossing out as sent, not done', async () => {
    await start();
    row('swap', userAddress, undefined, 'built');
    row('out', EVM, undefined, 'built');
    row('in', userAddress, undefined, 'planned');
    const out = row('out', EVM, SEEN);
    const into = row('in', userAddress, UNSEEN);
    const list = (await activity([userAddress, EVM])).json().crossings as Array<{ id: string; kind: 'out' | 'in'; status: string }>;
    expect(list.map((c) => c.id).sort()).toEqual([out, into].sort());
    expect(list.map((c) => activityState(c.kind, c.status))).toEqual(['sent', 'sent']);
  });

  it('returns at most activity.maxRows and refuses more than activity.maxAddresses', async () => {
    await start(patchConfig(base, JSON.stringify({ activity: { maxAddresses: 2, maxRows: 2 } })));
    for (let i = 0; i < 3; i++) row('swap', userAddress);
    expect((await activity([userAddress])).json().crossings).toHaveLength(2);
    expect((await activity([userAddress, EVM, otherAddress])).statusCode).toBe(400);
    expect((await activity([])).statusCode).toBe(400);
  });
});
