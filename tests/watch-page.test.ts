// /watch is served only while features.watchDemo is on; while it is off the address answers the static 404 page.
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { buildApp } from '../server/app.js';
import { createServices } from '../server/services.js';

const base = normalizeConfig(shipped as unknown as SampanConfig);
let app: FastifyInstance | undefined;
let dist: string;

const start = async (watchDemo: boolean) => {
  const c = patchConfig(base, JSON.stringify({ features: { watchDemo } }));
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-watch-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
  const services = createServices({ config: c, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
  app = await buildApp({ config: c, webDist: dist, fake: true, services, startWatcher: false });
  return app;
};
afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(dist, { recursive: true, force: true });
});

describe('/watch', () => {
  it('is the static 404 page while features.watchDemo is off', async () => {
    const res = await (await start(false)).inject({ method: 'GET', url: '/watch?dir=land' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('<title>app</title>');
  });
  it('is the page while the flag is on; other paths are unchanged', async () => {
    const a = await start(true);
    const res = await a.inject({ method: 'GET', url: '/watch?dir=land' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>app</title>');
    expect((await a.inject({ method: 'GET', url: '/how' })).statusCode).toBe(200);
  });
});
