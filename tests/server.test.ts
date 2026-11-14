import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { SampanConfig } from '../core/config.js';
import { buildApp } from '../server/app.js';

const config = JSON.parse(
  readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8'),
) as SampanConfig;

let dist: string;
let app: FastifyInstance;

beforeAll(async () => {
  dist = mkdtempSync(path.join(tmpdir(), 'sampan-web-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title><div id="root"></div>');
  writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  app = await buildApp({ config: { ...config, site: { ...config.site, noindex: true } }, webDist: dist, fake: true });
});

afterAll(async () => {
  await app.close();
  rmSync(dist, { recursive: true, force: true });
});

describe('server', () => {
  it('answers /healthz', async () => {
    const res = await app.inject('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('serves the public config without server-only sections', async () => {
    const res = await app.inject('/api/config');
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.fake).toBe(true);
    expect(body).toHaveProperty('banner');
    expect(body).not.toHaveProperty('electrum');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('serves index.html for page paths with no-transform, noindex and a strict CSP', async () => {
    for (const url of ['/', '/c/abc', '/how']) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache, no-transform');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      const csp = String(res.headers['content-security-policy']);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain('unsafe-inline');
    }
  });

  it('caches hashed assets for a year', async () => {
    const res = await app.inject('/assets/app-abc123.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('returns JSON 404 for unknown API paths and missing files', async () => {
    expect((await app.inject('/api/nope')).statusCode).toBe(404);
    expect((await app.inject('/missing.png')).statusCode).toBe(404);
  });

  it('drops the noindex header once the site is launched', async () => {
    const open = await buildApp({ config: { ...config, site: { ...config.site, noindex: false } }, webDist: dist, fake: true });
    const res = await open.inject('/');
    expect(res.headers['x-robots-tag']).toBeUndefined();
    await open.close();
  });
});
