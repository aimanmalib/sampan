// The banner's deck link: /slides (banner.deckUrl, features.slides) is the page, and the committed PDF it links answers at
// banner.deckPdfUrl as application/pdf (ADR 0070, ADR 0089).
import type { FastifyInstance } from 'fastify';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { normalizeConfig, type SampanConfig } from '../core/config.js';
import { buildApp } from '../server/app.js';
import { createServices } from '../server/services.js';

const config = normalizeConfig(shipped as unknown as SampanConfig);
let app: FastifyInstance | undefined;
let dist: string;

afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(dist, { recursive: true, force: true });
});

describe('event deck link', () => {
  it('answers banner.deckPdfUrl with the PDF and banner.deckUrl with the page', async () => {
    dist = mkdtempSync(path.join(tmpdir(), 'sampan-deck-'));
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
    mkdirSync(path.join(dist, 'deck'));
    copyFileSync(path.resolve('web/public/deck/sampan-blaze-2026.pdf'), path.join(dist, 'deck', 'sampan-blaze-2026.pdf'));
    const services = createServices({ config, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
    app = await buildApp({ config, webDist: dist, fake: true, services, startWatcher: false });
    const res = await app.inject({ method: 'GET', url: config.banner.deckPdfUrl });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const page = await app.inject({ method: 'GET', url: config.banner.deckUrl });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
  });
});
