// The /demo page (ADR 0082): the chapters file and its rules, the subtitle tracks in other languages, the config it
// reads, and the server answering /demo only while features.demo is on.
import type { FastifyInstance } from 'fastify';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import chapterFile from '../docs/demo/chapters.json' with { type: 'json' };
import { normalizeConfig, patchConfig, type SampanConfig } from '../core/config.js';
import { assetOfAmount, buildChapters, checkChapters, fillVars, validateDemo, type ChapterRun, type DemoConfig, type DemoFile } from '../core/demo.js';
import { parseRuns } from '../core/proof.js';
import { buildApp } from '../server/app.js';
import { contentSecurityPolicy } from '../server/security.js';
import { createServices } from '../server/services.js';
import { evenChunks, subKey, trackName, translatedTrack } from '../tools/video/demo-subs.js';

const config = normalizeConfig(shipped as unknown as SampanConfig);
const file = chapterFile as DemoFile;
const runs: ChapterRun[] = parseRuns(readFileSync('docs/MEASURED.md', 'utf8')).map((r) => ({ ok: r.ok, ids: r.txids.map((t) => t.id) }));
const lang = (code: string) => JSON.parse(readFileSync(`lang/${code}.json`, 'utf8')) as Record<string, string>;
const A = 'aa'.repeat(32);
const B = 'bb'.repeat(32);
const C = `0x${'cc'.repeat(32)}`;
const D = 'ee'.repeat(32);
const scene = (id: string, start: number, files: string[]) => ({ id, start, duration: 10, voiceAt: start + 0.4, voiceSeconds: 5, files });

describe('buildChapters', () => {
  const shots = [
    { clip: 'how.webm', txids: [A], site: 'https://site' },
    { clip: 'in.webm', txids: [B, C.toUpperCase().replace('0X', '0x'), 'dd'.repeat(32)], receipt: '/c/' + '1'.repeat(32), site: 'recording host' },
    { clip: 'land.webm', txids: [D], receipt: '/c/' + '2'.repeat(32), site: 'https://site' },
  ];
  const measured: ChapterRun[] = [
    { ok: true, ids: [A, D] },
    { ok: true, ids: [B, C] },
    // A dropped broadcast is written only in a fail row: never a chapter id.
    { ok: false, ids: [B, C, 'dd'.repeat(32)] },
  ];
  it('keeps the ok ids on screen, as MEASURED writes them, and drops scenes without one', () => {
    const ch = buildChapters([scene('open', 0, ['front.webm']), scene('proof', 10, ['how.webm']), scene('in', 20, ['in.webm']), scene('land', 30, ['land.webm'])], shots, measured, 'https://site');
    expect(ch.map((c) => c.id)).toEqual(['proof', 'in', 'land']);
    expect(ch[1]!.txids).toEqual([B, C]);
    expect(ch[1]!.titleKey).toBe('demo.ch.in');
  });
  it('lists an id once: a later scene showing only ids already listed is not a chapter', () => {
    const phone = { clip: 'how-phone.webm', txids: [A], site: 'https://site' };
    const ch = buildChapters([scene('proof', 10, ['how.webm']), scene('in', 20, ['in.webm', 'how-phone.webm']), scene('phone', 40, ['how-phone.webm'])], [...shots, phone], measured, 'https://site');
    expect(ch.map((c) => c.id)).toEqual(['proof', 'in']);
    expect(ch[1]!.txids).toEqual([B, C]);
  });
  it('links a receipt only when the shot ran on the live site', () => {
    const ch = buildChapters([scene('in', 20, ['in.webm']), scene('land', 30, ['land.webm'])], shots, measured, 'https://site');
    expect(ch[0]!.receipt).toBeUndefined();
    expect(ch[1]!.receipt).toBe('/c/' + '2'.repeat(32));
  });
});

describe('checkChapters', () => {
  const ids = [1, 2, 3, 4].map((n) => String(n).repeat(64));
  const good: ChapterRun[] = [{ ok: true, ids }];
  const ok: DemoFile = {
    seconds: 60,
    vars: { asset: 'USDC' },
    burnedSubtitles: false,
    scenes: [],
    chapters: [1, 2, 3, 4].map((n) => ({ id: `c${n}`, start: n * 10, titleKey: `demo.ch.c${n}`, txids: [ids[n - 1]!] })),
  };
  it('passes a good file and names each problem of a bad one', () => {
    expect(checkChapters(ok, good)).toEqual([]);
    const bad: DemoFile = { ...ok, chapters: [...ok.chapters.slice(0, 3), { id: 'x', start: 5, titleKey: 'demo.ch.x', txids: [B], receipt: '/c/no' }] };
    const errors = checkChapters(bad, [...good, { ok: false, ids: [B] }]).join('\n');
    expect(errors).toMatch(/x: start 5 does not come after 30/);
    expect(errors).toMatch(/not in an ok row of MEASURED/);
    expect(errors).toMatch(/is not a status page/);
    expect(checkChapters({ ...ok, chapters: ok.chapters.slice(0, 3) }, good)).toContain('fewer than 4 chapters');
  });
  it('refuses a web video with subtitles burned in, and an id listed by two chapters', () => {
    expect(checkChapters({ ...ok, burnedSubtitles: true }, good).join('\n')).toMatch(/subtitles burned in/);
    expect(checkChapters({ ...ok, burnedSubtitles: undefined as unknown as boolean }, good).join('\n')).toMatch(/subtitles burned in/);
    const twice: DemoFile = { ...ok, chapters: [...ok.chapters, { id: 'c5', start: 50, titleKey: 'demo.ch.c5', txids: [ids[0]!] }] };
    expect(checkChapters(twice, good).join('\n')).toMatch(/c5: .* is already listed by an earlier chapter/);
  });
  it('the shipped chapters file passes against docs/MEASURED.md', () => {
    expect(checkChapters(file, runs)).toEqual([]);
  });
});

describe('the shipped demo files', () => {
  it('names every chapter and every scene in every page language', () => {
    for (const { code } of config.i18n.languages) {
      const text = lang(code);
      for (const c of file.chapters) expect(text[c.titleKey], `${code} ${c.titleKey}`).toBeTruthy();
      for (const s of file.scenes) expect(text[subKey(s.id)], `${code} ${subKey(s.id)}`).toBeTruthy();
    }
  });
  it('says in English what the narration says (tools/video/captions.json)', () => {
    const captions = JSON.parse(readFileSync('tools/video/captions.json', 'utf8')) as { scenes: Array<{ id: string; text: string }> };
    const en = lang('en');
    for (const s of captions.scenes) expect(fillVars(en[subKey(s.id)]!, file.vars)).toBe(s.text);
  });
  it('tracks in other languages are what tools/video/demo-subs.ts writes from lang/', () => {
    const maxChars = (JSON.parse(readFileSync('tools/video/captions.json', 'utf8')) as { subtitle: { maxChars: number } }).subtitle.maxChars;
    for (const { code } of config.i18n.languages) {
      const f = path.join('web/public', trackName(config.demo.video, code));
      expect(existsSync(f), f).toBe(true);
      if (code !== 'en') expect(readFileSync(f, 'utf8')).toBe(translatedTrack(file, lang(code), maxChars));
    }
  });
  it('the video and poster are in web/public, the video under 25 MB', () => {
    const video = readFileSync(path.join('web/public', config.demo.video));
    expect(video.length).toBeLessThanOrEqual(25 * 1024 * 1024);
    expect(video.subarray(0, 64 * 1024).toString('latin1')).toContain('moov');
    expect(existsSync(path.join('web/public', config.demo.poster))).toBe(true);
  });
});

describe('assetOfAmount and fillVars', () => {
  it('reads the stablecoin after the chain and fills names it holds, leaving others visible', () => {
    expect(assetOfAmount('1.6 AVAX.USDC to PUSD (landing address)')).toBe('USDC');
    expect(assetOfAmount('0.001 BCH to 0.19 PUSD')).toBeNull();
    expect(fillVars('{asset} on {chain}', { asset: 'USDT' })).toBe('USDT on {chain}');
  });
});

describe('evenChunks', () => {
  it('splits at full stops followed by a space, never inside a domain name, into lines of even length', () => {
    expect(evenChunks('Try it at sampan.sasateguh.com.', 46)).toEqual(['Try it at sampan.sasateguh.com.']);
    const lines = evenChunks('It works on a phone too, and every crossing links to the explorers of both chains.', 46);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.length).toBeGreaterThan(30);
  });
  it('keeps every line within the limit', () => {
    const lines = evenChunks('a '.repeat(40) + 'word.', 10);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(10);
  });
});

describe('demo config', () => {
  const good: DemoConfig = { youtubeUrl: '', video: '/demo/v.mp4', poster: '/demo/v.jpg', txidsShown: 3 };
  it('ships valid, with the owner link empty and features.demo a boolean', () => {
    expect(validateDemo(shipped.demo as DemoConfig)).toEqual([]);
    expect(shipped.demo.youtubeUrl).toBe('');
    expect(typeof shipped.features.demo).toBe('boolean');
  });
  it.each([
    [{ youtubeUrl: 'http://youtube.com/x' }, 'demo.youtubeUrl'],
    [{ youtubeUrl: 'https://example.com/x' }, 'demo.youtubeUrl'],
    [{ video: 'https://cdn.example/v.mp4' }, 'demo.video'],
    [{ video: '/demo/v.webm' }, 'demo.video'],
    [{ poster: 'v.jpg' }, 'demo.poster'],
    [{ txidsShown: 0 }, 'demo.txidsShown'],
  ])('refuses %o', (patch, key) => {
    expect(validateDemo({ ...good, ...patch } as DemoConfig).join(' ')).toContain(key);
  });
  it('lets media come from this site only', () => {
    expect(contentSecurityPolicy(config)).toContain("media-src 'self'");
  });
});

describe('/demo on the server', () => {
  let app: FastifyInstance | undefined;
  let dist = '';
  const start = async (demo: boolean) => {
    const c = patchConfig(config, JSON.stringify({ features: { demo } }));
    dist = mkdtempSync(path.join(tmpdir(), 'sampan-demo-'));
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
  it('is the static 404 page while features.demo is off', async () => {
    const res = await (await start(false)).inject({ method: 'GET', url: '/demo' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('<title>app</title>');
  });
  it('is the page while the flag is on', async () => {
    const res = await (await start(true)).inject({ method: 'GET', url: '/demo' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>app</title>');
  });
});
