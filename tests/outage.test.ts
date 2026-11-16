// No blank screen (KPJ3): the server's answers when it fails (JSON under /api/, a static page elsewhere, with its own
// CSP hash and the text of every language), the fake outages the e2e suite runs against, and the one-time reload
// for a script that failed to load.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import { normalizeConfig, type SampanConfig } from '../core/config.js';
import { buildApp } from '../server/app.js';
import { readEnv } from '../server/env.js';
import { parseOutage, type Outage } from '../server/outage.js';
import { createServices } from '../server/services.js';
import { isChunkError, reloadOnce } from '../web/src/errors/reload-once.js';

const config = normalizeConfig(shipped as unknown as SampanConfig);
const fixture = path.resolve('tests/fixtures/cauldron-pusd-pools.json');
let app: FastifyInstance | undefined;
let dist: string | undefined;

const start = async (outage: Outage | null = null, fake = true) => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-outage-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root">x</div>');
  writeFileSync(path.join(dist, 'assets', 'app-1.js'), 'console.log(1)');
  writeFileSync(path.join(dist, 'assets', 'app-1.css'), ':root{--paper:#fff;--ink:#000}body{color:var(--ink)}');
  const services = createServices({ config, fake, dbFile: ':memory:', trustedProxies: [], fakeFixture: fixture, outage });
  app = await buildApp({ config, webDist: dist, fake, outage, services, startWatcher: false });
  return app;
};

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const styleHashOf = (html: string): string => createHash('sha256').update(/<style>([^<]*)<\/style>/.exec(html)![1]!).digest('base64');

describe('server failure answers', () => {
  it('answers a failing /api/ route with JSON server_error, without the internal message', async () => {
    const a = await start();
    a.get('/api/boom', async () => {
      throw new Error('secret internal detail');
    });
    const res = await a.inject('/api/boom');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'server_error', message: 'the server failed; try again' });
    expect(res.body).not.toContain('secret');
  });

  it('answers a failing page with the static error page in every language, styled under its own CSP hash', async () => {
    const a = await start();
    a.get('/boom', async () => {
      throw new Error('secret internal detail');
    });
    const res = await a.inject('/boom');
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toContain('text/html');
    for (const t of [en, ms]) {
      expect(res.body).toContain(t['error.page.failed']);
      expect(res.body).toContain(t['error.page.home']);
    }
    expect(res.body).not.toContain('secret');
    expect(res.body).not.toContain('<script');
    expect(res.body).toContain('--paper:#fff'); // the page's own colour tokens from the built stylesheet
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain(`'sha256-${styleHashOf(res.body)}'`);
    expect(csp).toContain("script-src 'self'");
  });

  it('keeps 4xx validation answers as they were', async () => {
    const a = await start();
    const res = await a.inject({ method: 'POST', url: '/api/swap/quote', payload: { nope: 1 } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ statusCode: 400 });
  });

  it('gives the static 404 page for a missing file and JSON 404 under /api/', async () => {
    const a = await start();
    const page = await a.inject('/missing.png');
    expect(page.statusCode).toBe(404);
    expect(page.body).toContain(en['error.page.notFound']);
    expect(page.body).toContain(ms['error.page.notFound']);
    expect(String(page.headers['content-security-policy'])).toContain(`'sha256-${styleHashOf(page.body)}'`);
    const api = await a.inject('/api/nope');
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'not_found' });
    // Every other page keeps the site policy, with no inline style allowed.
    expect(String((await a.inject('/')).headers['content-security-policy'])).toContain("style-src 'self';");
  });
});

describe('fake outages (SAMPAN_FAKE_OUTAGE)', () => {
  it('reads the variable with the fake network only and rejects unknown names', () => {
    expect(readEnv({ SAMPAN_FAKE: '1', SAMPAN_FAKE_OUTAGE: 'api' }).fakeOutage).toBe('api');
    expect(readEnv({ SAMPAN_FAKE_OUTAGE: 'api' }).fakeOutage).toBeNull();
    expect(parseOutage(undefined)).toBeNull();
    expect(() => parseOutage('apii')).toThrow(/SAMPAN_FAKE_OUTAGE/);
  });

  it('api: every /api/ path answers 503, the page itself still loads', async () => {
    const a = await start('api');
    expect((await a.inject('/api/config')).statusCode).toBe(503);
    expect((await a.inject('/api/health')).statusCode).toBe(503);
    expect((await a.inject('/')).statusCode).toBe(200);
  });

  it('chunk: scripts under /assets/ fail, the stylesheet and page do not', async () => {
    const a = await start('chunk');
    expect((await a.inject('/assets/app-1.js')).statusCode).toBe(404);
    expect((await a.inject('/assets/app-1.css')).statusCode).toBe(200);
    expect((await a.inject('/')).statusCode).toBe(200);
  });

  it('render: /api/config comes without tokens', async () => {
    const a = await start('render');
    expect((await a.inject('/api/config')).json().tokens).toEqual({});
  });

  it('indexer and electrum: health names the provider that is down', async () => {
    for (const [outage, down] of [['indexer', 'cauldron'], ['electrum', 'bch']] as const) {
      const services = createServices({ config, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: fixture, outage });
      const report = await services.health.check();
      expect(report[down], outage).toBe(false);
      services.db.close();
    }
  });

  it('is ignored on the real network', async () => {
    const a = await start('api', false);
    // Without the fake network the hook is never installed: /api/config answers.
    expect((await a.inject('/api/config')).statusCode).toBe(200);
  });
});

describe('reload once for a script that failed to load', () => {
  const storage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('knows the browser messages for a failed module load and nothing else', () => {
    expect(isChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true);
    expect(isChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkError(new TypeError("Cannot read properties of undefined (reading 'symbol')"))).toBe(false);
  });

  it('reloads the first time only, and never when storage is blocked', () => {
    const s = storage();
    const reload = vi.fn();
    expect(reloadOnce({ storage: s, reload })).toBe(true);
    expect(reloadOnce({ storage: s, reload })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    const blocked = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    expect(reloadOnce({ storage: blocked, reload })).toBe(false);
    expect(reloadOnce({ storage: null, reload })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
