// The demo videos are served to the media host name only (ADR 0084): another host asking for /media/* gets the 404
// page, the media host gets the file with a range answer, and the site's own host no longer has a video under /demo.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaFile, validateDemo, validateMedia, type DemoConfig } from '../core/demo.js';
import { patchConfig } from '../core/config.js';
import { loadConfig } from '../server/config.js';
import { buildApp } from '../server/app.js';
import { contentSecurityPolicy } from '../server/security.js';
import { createServices } from '../server/services.js';

const shipped = loadConfig('config/sampan.json');
const HOST = 'media.example.test';
const config = patchConfig(shipped, JSON.stringify({ media: { host: HOST, cacheControl: 'public, max-age=60' } }));
const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));

describe('/media/* on the server', () => {
  let app: FastifyInstance;
  let dir = '';
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sampan-media-'));
    mkdirSync(path.join(dir, 'web'));
    writeFileSync(path.join(dir, 'web', 'index.html'), '<!doctype html><title>app</title>');
    mkdirSync(path.join(dir, 'media', 'demo'), { recursive: true });
    writeFileSync(path.join(dir, 'media', 'demo', 'clip.mp4'), bytes);
    writeFileSync(path.join(dir, 'secret.txt'), 'not media');
    const services = createServices({ config, fake: true, dbFile: ':memory:', trustedProxies: [], fakeFixture: path.resolve('tests/fixtures/cauldron-pusd-pools.json') });
    app = await buildApp({ config, webDist: path.join(dir, 'web'), mediaDir: path.join(dir, 'media'), fake: true, services, startWatcher: false });
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers the media host with a 206 range of the file, as video/mp4 with the configured caching', async () => {
    const res = await app.inject({ method: 'GET', url: '/media/demo/clip.mp4', headers: { host: HOST, range: 'bytes=0-1023' } });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-type']).toContain('video/mp4');
    expect(res.headers['content-range']).toBe(`bytes 0-1023/${bytes.length}`);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.rawPayload.equals(bytes.subarray(0, 1024))).toBe(true);
  });
  it('answers the whole file without a range, and the media host with a port too', async () => {
    const res = await app.inject({ method: 'GET', url: '/media/demo/clip.mp4', headers: { host: `${HOST}:443` } });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBe(bytes.length);
  });
  it.each(['sampan.sasateguh.com', 'localhost', 'evil.example'])('is the 404 page for host %s', async (host) => {
    const res = await app.inject({ method: 'GET', url: '/media/demo/clip.mp4', headers: { host, range: 'bytes=0-1023' } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).not.toContain('video');
  });
  it('serves nothing outside the media folder and no missing file', async () => {
    for (const url of ['/media/../secret.txt', '/media/%2e%2e/secret.txt', '/media/demo/none.mp4', '/media/']) {
      const res = await app.inject({ method: 'GET', url, headers: { host: HOST } });
      expect([403, 404], url).toContain(res.statusCode);
      expect(res.body, url).not.toContain('not media');
    }
  });
  it('has no video under /demo on the site host', async () => {
    const res = await app.inject({ method: 'GET', url: '/demo/sampan-demo.mp4', headers: { host: 'sampan.sasateguh.com', range: 'bytes=0-1023' } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).not.toContain('video');
  });
});

describe('media config', () => {
  it('ships the videos as media host URLs of tracked files, the host allowed by the page policy', () => {
    expect(validateMedia(shipped.media, shipped.site.url)).toEqual([]);
    expect(validateDemo(shipped.demo, shipped.media.host)).toEqual([]);
    expect(mediaFile(shipped.demo.video, shipped.media.host)).toBe('media/demo/sampan-demo-60.mp4');
    expect(mediaFile(shipped.demo.videoLong, shipped.media.host)).toBe('media/demo/sampan-demo.mp4');
    expect(contentSecurityPolicy(shipped)).toContain(`media-src 'self' https://${shipped.media.host};`);
  });
  it('refuses the site host as media host, and a video on the site or another host', () => {
    expect(validateMedia({ host: 'sampan.sasateguh.com', cacheControl: 'no-store' }, 'https://sampan.sasateguh.com').join(' ')).toContain('media.host');
    const good: DemoConfig = { ...shipped.demo };
    for (const video of ['/demo/v.mp4', 'https://cdn.example/media/v.mp4', `http://${HOST}/media/v.mp4`, `https://${HOST}/v.mp4`, `https://${HOST}/media/v.webm`]) {
      expect(validateDemo({ ...good, video }, HOST).join(' '), video).toContain('demo.video');
    }
    expect(validateDemo({ ...good, videoLong: '/x.mp4' }, HOST).join(' ')).toContain('demo.videoLong');
    expect(validateDemo({ ...good, tracks: '/demo/x.vtt' }, HOST).join(' ')).toContain('demo.tracks');
  });
});
