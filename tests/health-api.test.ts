// Health: the monitor's report from its probes, GET /api/health on the fake network, the 451 answer for blocked
// countries (through Cloudflare only) and new crossings paused while the route reports a halt.
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { liveAssets, openMapOf, withLive, type InboundRow } from '../core/route-assets.js';
import { buildApp } from '../server/app.js';
import { ChainUnavailableError } from '../server/chain/types.js';
import { HealthMonitor } from '../server/health.js';
import { createServices, type Services } from '../server/services.js';

const base = normalizeConfig(shipped as unknown as SampanConfig);
const crossOn = patchConfig(base, JSON.stringify({ compliance: { crossChainEnabled: true }, thorchain: { assets: withLive(base.thorchain.assets, ['BASE']) }, rate: { quotesPerMinute: 1000, crossingsPerHour: 1000 } }));
const LIVE_BASE = liveAssets(crossOn.thorchain.assets);
const CF = '104.16.1.2';
const PROXY = '10.0.0.2';
const BLOCKED = base.compliance.blockedCountries[0]!;
const quote = { source: 'BCH', amount: '1000000', symbol: 'USDC', chain: 'BASE', destination: '0x1a877169bB03400fA69EC4813889E78994D194Cb' };

let app: FastifyInstance | undefined;
let services: Services;
let dist: string | undefined;

const start = async (c: SampanConfig) => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-health-'));
  services = createServices({ config: c, fake: true, dbFile: ':memory:', trustedProxies: [PROXY], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config: c, webDist: dist, fake: true, services, startWatcher: false });
  return app;
};
afterEach(async () => {
  await app?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
  app = undefined;
});

const fail = async (): Promise<number> => {
  throw new Error('down');
};

describe('HealthMonitor', () => {
  it('reports each probe and leaves the route out while crossings are closed', async () => {
    const m = new HealthMonitor({ pools: async () => 3, tipHeight: async () => 900_000, intervalMs: 60_000, retryMs: 5_000, now: () => 5 });
    expect(m.current()).toEqual({ checkedAt: null, cauldron: null, bch: null, height: null, route: null });
    expect(await m.check()).toEqual({ checkedAt: 5, cauldron: true, bch: true, height: 900_000, route: null });
    expect(m.routeOpen()).toBe(true);
  });

  it('marks failing probes false, no pools as not ok, and a halted route as paused', async () => {
    const m = new HealthMonitor({
      pools: async () => 0,
      tipHeight: fail,
      route: { id: 'thorchain', open: async () => ({ BCH: false, BASE: true }), assets: LIVE_BASE },
      intervalMs: 60_000, retryMs: 5_000,
    });
    expect(m.routeOpen()).toBe(true);
    const r = await m.check();
    expect([r.cauldron, r.bch, r.height, r.route]).toEqual([false, false, null, { id: 'thorchain', open: false, chains: { BCH: false, BASE: true } }]);
    expect(m.routeOpen()).toBe(false);
  });

  it('leaves Cauldron unknown when the pools cannot be checked because the Bitcoin Cash servers are down', async () => {
    const chainDown = async (): Promise<number> => {
      throw new ChainUnavailableError('Bitcoin Cash servers unavailable');
    };
    const m = new HealthMonitor({ pools: chainDown, tipHeight: fail, intervalMs: 60_000, retryMs: 5_000 });
    const r = await m.check();
    expect([r.cauldron, r.bch]).toEqual([null, false]);
    expect(m.allOk()).toBe(false);
    const indexerDown = new HealthMonitor({ pools: fail, tipHeight: async () => 1, intervalMs: 60_000, retryMs: 5_000 });
    expect((await indexerDown.check()).cauldron).toBe(false);
  });

  it('keeps a route that cannot be asked unknown, so crossings stay open and the next check comes after retryMs', async () => {
    const m = new HealthMonitor({ pools: async () => 1, tipHeight: async () => 1, route: { id: 'thorchain', open: fail as never, assets: LIVE_BASE }, intervalMs: 60_000, retryMs: 5_000 });
    expect((await m.check()).route).toEqual({ id: 'thorchain', open: null, chains: null });
    expect(m.chainOpen('BASE')).toBe(true);
    expect(m.routeOpen()).toBe(true);
    expect(m.allOk()).toBe(false);
  });
});

describe('HealthMonitor schedule', () => {
  afterEach(() => vi.useRealTimers());

  it('re-checks after retryMs while a probe is down (a start that races the first connection), then every intervalMs', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const logs: string[] = [];
    const m = new HealthMonitor({
      pools: async () => {
        calls += 1;
        if (calls === 1) throw new Error('not connected yet');
        return 2;
      },
      tipHeight: async () => 1,
      intervalMs: 60_000,
      retryMs: 5_000,
      log: (x) => logs.push(x),
    });
    m.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.current().cauldron).toBe(false);
    expect(logs).toEqual(['health: cauldron probe failed: not connected yet']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.current().cauldron).toBe(true);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(3);
    m.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(3);
  });
});

describe('GET /api/health', () => {
  it('answers the last check on the fake network; no route while crossings are off', async () => {
    await start(base);
    await services.health.check();
    const h = (await app!.inject({ method: 'GET', url: '/api/health' })).json();
    expect(h).toMatchObject({ cauldron: true, bch: true, route: null });
    expect(typeof h.checkedAt).toBe('number');
  });

  it('includes the active route while crossings are on', async () => {
    await start(crossOn);
    await services.health.check();
    const h = (await app!.inject({ method: 'GET', url: '/api/health' })).json();
    expect(h.route).toEqual({ id: crossOn.route.active, open: true, chains: { BASE: true, BCH: true } });
  });
});

describe('new crossings: region and route pause', () => {
  const post = (url: string, headers: Record<string, string>) =>
    app!.inject({ method: 'POST', url, payload: quote, remoteAddress: PROXY, headers });

  it('answers 451 to a blocked country seen through Cloudflare, on out and in', async () => {
    await start(crossOn);
    const res = await post('/api/out/quote', { 'x-forwarded-for': CF, 'cf-ipcountry': BLOCKED });
    expect(res.statusCode).toBe(451);
    expect(res.json().error).toBe('restricted_region');
    const inRes = await app!.inject({
      method: 'POST',
      url: '/api/in/quote',
      payload: { symbol: 'USDC', chain: 'BASE', amount: '500000000', receive: 'PUSD', address: 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt' },
      remoteAddress: PROXY,
      headers: { 'x-forwarded-for': CF, 'cf-ipcountry': BLOCKED },
    });
    expect(inRes.statusCode).toBe(451);
  });

  it('ignores cf-ipcountry that did not come through Cloudflare', async () => {
    await start(crossOn);
    const res = await post('/api/out/quote', { 'x-forwarded-for': '1.2.3.4', 'cf-ipcountry': BLOCKED });
    expect(res.statusCode).toBe(200);
  });

  it('pauses new crossings after the route reports a halt, and reopens after it clears', async () => {
    await start(crossOn);
    const route = services.route!;
    const open = route.open.bind(route);
    route.open = async () => ({ BCH: false, BASE: true });
    await services.health.check();
    const res = await post('/api/out/quote', {});
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('route_paused');
    route.open = open;
    await services.health.check();
    expect((await post('/api/out/quote', {})).statusCode).toBe(200);
  });

  it('refuses only the asset whose chain is closed (503 chain_halted); assets on open chains keep quoting', async () => {
    // Inbound state read from THORNode on 2026-11-17: Base halted, Ethereum and the others open.
    const inbound = JSON.parse(readFileSync('tests/fixtures/thorchain/inbound-2026-11-17.json', 'utf8')) as InboundRow[];
    await start(patchConfig(crossOn, JSON.stringify({ thorchain: { assets: withLive(base.thorchain.assets, ['BASE', 'ETH']) } })));
    services.route!.open = async () => openMapOf(inbound);
    const h = await services.health.check();
    expect(h.route).toMatchObject({ open: true, chains: { BCH: true, ETH: true, BASE: false } });
    const baseRes = await post('/api/out/quote', {});
    expect([baseRes.statusCode, baseRes.json().error]).toEqual([503, 'chain_halted']);
    const ethOut = await app!.inject({ method: 'POST', url: '/api/out/quote', payload: { ...quote, chain: 'ETH' }, remoteAddress: PROXY });
    expect(ethOut.statusCode).toBe(200);
    const inRes = await app!.inject({
      method: 'POST',
      url: '/api/in/quote',
      payload: { symbol: 'USDC', chain: 'BASE', amount: '500000000', receive: 'BCH', address: 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt' },
      remoteAddress: PROXY,
    });
    expect([inRes.statusCode, inRes.json().error]).toEqual([503, 'chain_halted']);
  });

  it('refuses an asset config does not mark live for that direction with 400', async () => {
    await start(crossOn);
    const res = await app!.inject({ method: 'POST', url: '/api/out/quote', payload: { ...quote, chain: 'ETH' }, remoteAddress: PROXY });
    expect([res.statusCode, res.json().error]).toEqual([400, 'bad_request']);
  });

  it('pauses every crossing when all live chains are closed, as when BCH is', async () => {
    await start(crossOn);
    services.route!.open = async () => ({ BCH: true, BASE: false, ETH: true });
    await services.health.check();
    const res = await post('/api/out/quote', {});
    expect([res.statusCode, res.json().error]).toEqual([503, 'route_paused']);
  });
});
