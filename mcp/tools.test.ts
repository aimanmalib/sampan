import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from './register.js';
import { baseUrl, type SiteConfig } from './tools.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CARD = JSON.parse(readFileSync(new URL('../tests/fixtures/landing-card.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const OWNER = CARD.ownerAddress as string;
const ID = 'ab'.repeat(16);
const BASE = 'http://sampan.test';

const siteConfig = (pay: boolean): SiteConfig => ({
  tokens: { PUSD: { symbol: 'PUSD', category: CARD.category as string, decimals: 2 } },
  defaultToken: 'PUSD',
  features: { swap: true, landing: true, pay },
  landing: { returnAfterBlocks: 6 },
});

type Route = (body: unknown) => { status?: number; json: unknown };

/** A fetch that answers from a table of "METHOD /path" routes and records every call. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const route = routes[`${method} ${url.replace(BASE, '')}`];
    if (!route) return new Response(JSON.stringify({ error: 'not_found', message: 'no route' }), { status: 404 });
    const r = route(body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}

const QUOTE = { quote: { token: 'PUSD', category: CARD.category, side: 'buy', supply: '100000', demand: '20', minReceive: '19', sampanFeeSats: '0', pools: 1, usd: 0.2 } };
const OPEN = (card: unknown) => ({ json: { crossingId: ID, card, minSats: '50000', tokensMin: '10', validHours: 24 } });

async function connect(routes: Record<string, Route>, pay = false) {
  const { f, calls } = fakeFetch(routes);
  const server = buildServer({ base: BASE, fetch: f }, siteConfig(pay), 'test');
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, calls };
}

const text = (r: unknown): string => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? '');

describe('mcp tools', () => {
  it('lists the three tools, and create_invoice only when Sampan Pay is on', async () => {
    const off = await connect({});
    expect((await off.client.listTools()).tools.map((t) => t.name).sort()).toEqual(['create_landing_address', 'get_crossing_status', 'quote_swap']);
    const on = await connect({}, true);
    expect((await on.client.listTools()).tools.map((t) => t.name)).toContain('create_invoice');
    const tools = (await on.client.listTools()).tools;
    expect(tools.find((t) => t.name === 'quote_swap')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'get_crossing_status')?.annotations?.readOnlyHint).toBe(true);
    for (const t of tools.filter((t) => t.name !== 'get_crossing_status')) expect(t.description).toMatch(/never signs/);
  });

  it('quote_swap turns a decimal amount into base units and back', async () => {
    const { client, calls } = await connect({ 'POST /api/swap/quote': () => ({ json: QUOTE }) });
    const r = await client.callTool({ name: 'quote_swap', arguments: { side: 'buy', amount: '0.001' } });
    expect(r.isError).toBeFalsy();
    expect(calls[0]?.body).toEqual({ token: 'PUSD', side: 'buy', amount: '100000' });
    expect(r.structuredContent).toMatchObject({ pay: { amount: '0.001', unit: 'BCH' }, receive: { amount: '0.2', atLeast: '0.19', unit: 'PUSD' } });
  });

  it('create_landing_address returns the address after recomputing it from the card', async () => {
    const { client } = await connect({ 'POST /api/land/open': () => OPEN(CARD) });
    const r = await client.callTool({ name: 'create_landing_address', arguments: { ownerAddress: OWNER } });
    expect(r.isError, text(r)).toBeFalsy();
    const out = r.structuredContent as Record<string, string>;
    expect(out.address).toBe(CARD.address);
    expect(out.statusUrl).toMatch(new RegExp(`^${BASE}/c/${ID}#card=`));
    expect(out.minimumBch).toBe('0.0005');
  });

  it('refuses a landing address from the server that does not match its card', async () => {
    const fake = { ...CARD, address: 'bitcoincash:pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' };
    const { client } = await connect({ 'POST /api/land/open': () => OPEN(fake) });
    const r = await client.callTool({ name: 'create_landing_address', arguments: { ownerAddress: OWNER } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/refused the address/);
  });

  it('refuses a self-consistent card that pays someone else', async () => {
    const { client } = await connect({ 'POST /api/land/open': () => OPEN(CARD) });
    const r = await client.callTool({ name: 'create_landing_address', arguments: { ownerAddress: 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/pays someone else/);
  });

  it('get_crossing_status passes the status through and reports API refusals as tool errors', async () => {
    const { client } = await connect({ [`GET /api/crossings/${ID}`]: () => ({ json: { id: ID, kind: 'land', status: 'open' } }) });
    const ok = await client.callTool({ name: 'get_crossing_status', arguments: { id: ID } });
    expect(ok.structuredContent).toMatchObject({ status: 'open' });
    const missing = await client.callTool({ name: 'get_crossing_status', arguments: { id: 'cd'.repeat(16) } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatch(/404/);
  });

  it('rejects bad input by schema before any request', async () => {
    const { client, calls } = await connect({});
    const r = await client.callTool({ name: 'get_crossing_status', arguments: { id: 'not-hex' } });
    expect(r.isError).toBe(true);
    const q = await client.callTool({ name: 'quote_swap', arguments: { side: 'hold', amount: '1' } });
    expect(q.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('create_invoice sends only the merchant fields and returns the payment link', async () => {
    const reply = { id: ID, address: 'bitcoincash:pzgf0tu80y3s492q8lllwsr9fh75cn5cyurtare0hq', bip21: 'bitcoincash:pzgf0tu80y3s492q8lllwsr9fh75cn5cyurtare0hq?amount=0.001', statusUrl: `${BASE}/pay/i/${ID}`, usd: '1.00', requiredSats: '100000', expiresAt: '2026-11-17T00:00:00Z' };
    const { client, calls } = await connect({ 'POST /api/pay/invoice': () => ({ json: reply }) }, true);
    const r = await client.callTool({ name: 'create_invoice', arguments: { usd: 1, merchantAddress: OWNER } });
    expect(r.isError, text(r)).toBeFalsy();
    expect(calls[0]?.body).toEqual({ usd: 1, merchantAddress: OWNER });
    expect(r.structuredContent).toMatchObject({ bch: '0.001', paymentUri: reply.bip21 });
  });

  it('baseUrl prefers SAMPAN_URL and refuses other schemes', () => {
    expect(baseUrl(undefined, 'https://example.org/')).toBe('https://example.org');
    expect(baseUrl('http://127.0.0.1:9/', 'https://example.org')).toBe('http://127.0.0.1:9');
    expect(() => baseUrl('file:///etc/passwd', 'https://example.org')).toThrow();
  });
});

describe('mcp server over stdio, started with the README command', () => {
  let http: Server;
  let url = '';
  beforeAll(async () => {
    http = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/config') res.end(JSON.stringify(siteConfig(false)));
      else if (req.url === '/api/swap/quote') res.end(JSON.stringify(QUOTE));
      else res.writeHead(404).end('{"error":"not_found"}');
    });
    await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
    const addr = http.address();
    url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });
  afterAll(() => new Promise<void>((ok) => http.close(() => ok())));

  it('answers on stdout with protocol messages only', async () => {
    // README: npm --prefix /path/to/sampan run --silent mcp (run here from another folder).
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !e[0].startsWith('GIT_')));
    const transport = new StdioClientTransport({ command: 'npm', args: ['--prefix', ROOT, 'run', '--silent', 'mcp'], cwd: tmpdir(), env: { ...env, SAMPAN_URL: url }, stderr: 'pipe' });
    const client = new Client({ name: 'stdio-test', version: '1' });
    const errors: unknown[] = [];
    client.onerror = (e) => errors.push(e);
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain('quote_swap');
      const r = await client.callTool({ name: 'quote_swap', arguments: { side: 'buy', amount: '0.001' } });
      expect(r.structuredContent).toMatchObject({ receive: { unit: 'PUSD' } });
      expect(errors).toEqual([]);
    } finally {
      await client.close();
    }
  }, 60_000);
});
