import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { binToHex } from '@bitauth/libauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LANDING_RATE_DEN } from '../core/landing.js';
import { makeCard } from '../core/landing-card.js';
import { parseAddress } from '../core/address.js';
import { loadConfig } from '../server/config.js';
import { emptyState, readState, step, type ProbeResult, type SyntheticState } from '../tools/synthetic/alerts.js';
import { landingOwner, runProbes, type ProbeDeps } from '../tools/synthetic/probes.js';
import { userLock } from './helpers/pools.js';

const en = JSON.parse(readFileSync('lang/en.json', 'utf8')) as Record<string, string>;
const texts = (k: string) => en[k];
const at = (h: number) => new Date(Date.UTC(2026, 10, 16, h));
const res = (probe: string, ok: boolean, detail = ''): ProbeResult => ({ probe, ok, ms: 1, detail });

function runAll(steps: Array<[number, ProbeResult[]]>, start: SyntheticState = emptyState()) {
  let state = start;
  return steps.map(([h, results]) => {
    const out = step(state, results, at(h), texts);
    state = out.state;
    return out.alerts;
  });
}

describe('synthetic alert rule', () => {
  it('stays quiet on the first failure and alerts once on the second', () => {
    const [a1, a2, a3] = runAll([[1, [res('quote', false, 'x')]], [2, [res('quote', false, 'x')]], [3, [res('quote', false, 'x')]]]);
    expect(a1).toEqual([]);
    expect(a2).toHaveLength(1);
    expect(a2![0]!.level).toBe('warn');
    expect(a2![0]!.text).toContain(en['alerts.synthetic.quote']!.split(' (')[0]);
    expect(a3).toEqual([]);
  });

  it('a failure between successes never alerts', () => {
    const alerts = runAll([[1, [res('page', false)]], [2, [res('page', true)]], [3, [res('page', false)]], [4, [res('page', true)]]]);
    expect(alerts.flat()).toEqual([]);
  });

  it('sends one info on recovery and no second warn the same day', () => {
    const alerts = runAll([
      [1, [res('page', false)]],
      [2, [res('page', false)]],
      [3, [res('page', true)]],
      [4, [res('page', false)]],
      [5, [res('page', false)]],
    ]);
    expect(alerts.map((a) => a.map((x) => x.level))).toEqual([[], ['warn'], ['info'], [], []]);
    expect(alerts[2]![0]!.text).toContain('page');
  });

  it('alerts again on a new UTC day', () => {
    const first = runAll([[1, [res('page', false)]], [2, [res('page', false)]], [3, [res('page', true)]]]);
    expect(first[1]).toHaveLength(1);
    let state = emptyState();
    for (const [h, r] of [[1, false], [2, false], [3, true]] as const) state = step(state, [res('page', r)], at(h), texts).state;
    const nextDay = (h: number) => new Date(Date.UTC(2026, 10, 17, h));
    state = step(state, [res('page', false)], nextDay(1), texts).state;
    expect(step(state, [res('page', false)], nextDay(2), texts).alerts).toHaveLength(1);
  });

  it('several probes going down in one run share one message', () => {
    const down = ['page', 'config', 'health'].map((p) => res(p, false, 'fetch failed'));
    const [a1, a2] = runAll([[1, down], [2, down]]);
    expect(a1).toEqual([]);
    expect(a2).toHaveLength(1);
    expect(a2![0]!.text).toContain('config, health');
  });

  it('a probe not run in a pass keeps its count', () => {
    const [a1, , a3] = runAll([[1, [res('render', false)]], [2, [res('page', true)]], [13, [res('render', false)]]]);
    expect(a1).toEqual([]);
    expect(a3).toHaveLength(1);
  });

  it('keeps the latest runs and survives a damaged state file', () => {
    const { state } = step(readState('{not json'), [res('page', true)], at(1), texts);
    expect(state.runs).toEqual([{ at: at(1).toISOString(), ok: true, failed: [] }]);
  });
});

const config = loadConfig('config/sampan.json');
const deps = (over: Partial<ProbeDeps> = {}): ProbeDeps => ({
  fetch,
  timeoutMs: 3000,
  tipHeight: async () => 900_000,
  activePools: async () => 5,
  inbound: async () => [{ chain: 'BCH' }, { chain: 'BASE' }],
  ...over,
});

describe('provider probes', () => {
  const ctx = (d: ProbeDeps, cross = false) => ({ url: 'http://127.0.0.1:1', config: { ...config, compliance: { ...config.compliance, crossChainEnabled: cross } }, deps: d });

  it('one Electrum server down is a detail, not a failure', async () => {
    const first = config.electrum.servers[0]!;
    const [r] = await runProbes(ctx(deps({ tipHeight: async (s) => (s === first ? Promise.reject(new Error('refused')) : 900_000) })), ['electrum']);
    expect(r!.ok).toBe(true);
    expect(r!.detail).toContain(new URL(first).host);
  });

  it('every Electrum server down is a failure', async () => {
    const [r] = await runProbes(ctx(deps({ tipHeight: () => Promise.reject(new Error('refused')) })), ['electrum']);
    expect(r!.ok).toBe(false);
  });

  it('an indexer without pools fails', async () => {
    const [r] = await runProbes(ctx(deps({ activePools: async () => 0 })), ['indexer']);
    expect(r!.ok).toBe(false);
  });

  it('a halted chain fails thornode only while crossings are open', async () => {
    const halted = deps({ inbound: async () => [{ chain: 'BCH', halted: true }, { chain: 'BASE' }] });
    expect((await runProbes(ctx(halted, false), ['thornode']))[0]!.ok).toBe(true);
    expect((await runProbes(ctx(halted, true), ['thornode']))[0]!.ok).toBe(false);
    expect((await runProbes(ctx(deps(), true), ['thornode']))[0]!.ok).toBe(true);
  });
});

describe('site probes against a local server', () => {
  let server: Server;
  let url = '';
  let missingAsset = false;
  let card: unknown;
  beforeAll(async () => {
    server = createServer((req, reply) => {
      const send = (code: number, body: string, headers: Record<string, string> = {}) => reply.writeHead(code, headers).end(body);
      if (req.url === '/') return send(200, '<script type="module" crossorigin src="/assets/a.js"></script><link rel="stylesheet" crossorigin href="/assets/a.css">', { 'content-security-policy': "default-src 'self'" });
      if (req.url === '/assets/a.js') return send(missingAsset ? 404 : 200, '');
      if (req.url === '/assets/a.css') return send(200, '');
      if (req.url === '/api/config') return send(200, JSON.stringify({ features: { landing: true } }));
      if (req.url === '/api/land/open') return send(200, JSON.stringify({ card }));
      return send(404, '');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  const ctx = () => ({ url, config, deps: deps() });

  it('page passes with every asset and fails when one is missing', async () => {
    expect((await runProbes(ctx(), ['page']))[0]!.ok).toBe(true);
    missingAsset = true;
    const [r] = await runProbes(ctx(), ['page']);
    missingAsset = false;
    expect(r!.ok).toBe(false);
    expect(r!.detail).toContain('/assets/a.js');
  });

  it('landing recomputes the address from the card and refuses a card that does not match', async () => {
    const good = makeCard(
      { ownerLockHex: binToHex(userLock), category: config.tokens[config.defaultToken]!.category, rateNum: 48_000n, rateDen: LANDING_RATE_DEN, returnAfter: 6 },
      { network: 'mainnet', token: 'PUSD', created: new Date('2026-11-16T00:00:00Z') },
    );
    card = JSON.parse(JSON.stringify(good));
    expect((await runProbes(ctx(), ['landing']))[0]!.ok).toBe(true);
    card = { ...(card as object), rateNum: '48001' };
    expect((await runProbes(ctx(), ['landing']))[0]!.ok).toBe(false);
  });

  it('opens landings for the test wallet only', () => {
    const owner = parseAddress(landingOwner(config), 'bitcoincash');
    const test = parseAddress(config.ops.testAddresses[0]!, 'bitcoincash');
    expect(typeof owner !== 'string' && typeof test !== 'string' && owner.lockingHex === test.lockingHex).toBe(true);
  });
});

describe('deploy/synthetic.sh', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'sampan-synthetic-'));
    writeFileSync(path.join(dir, 'alert-hook'), `#!/bin/sh\nprintf '%s|%s\\n' "$2" "$1" >> "${dir}/sent.log"\n`);
    chmodSync(path.join(dir, 'alert-hook'), 0o755);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const sent = () => {
    try {
      return readFileSync(path.join(dir, 'sent.log'), 'utf8').trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };

  it('a wrong URL alerts exactly once, on the second run', async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, SYNTHETIC_URL: 'http://127.0.0.1:1', SYNTHETIC_STATE: path.join(dir, 'state'),
      SYNTHETIC_NOTIFY: path.join(dir, 'alert-hook'), SYNTHETIC_LANG: 'en', SYNTHETIC_ONLY: 'page,config', SYNTHETIC_TIMEOUT_MS: '2000',
      SAMPAN_NODE: process.execPath };
    for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
    const run = (now: number) => promisify(execFile)('bash', ['deploy/synthetic.sh'], { env: { ...env, SYNTHETIC_NOW: String(now) } });
    const t0 = Date.UTC(2026, 10, 16, 1) / 1000;
    const first = await run(t0);
    expect(first.stdout).toContain('"probe":"page","ok":false');
    expect(sent()).toEqual([]);
    await run(t0 + 3600);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatch(/^warn\|/);
    await run(t0 + 7200);
    expect(sent()).toHaveLength(1);
  }, 60_000);
});
