// The atomic swap client is a byte copy of a build from one commit of its own repository (ADR 0038): the file must be
// the one config names, point at the contract config names, and the page must not reach the client's servers while
// the route is off.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { atomConnectOrigins, validateAtom } from '../core/atom-config.js';
import { publicConfig, validateConfig, type SampanConfig } from '../core/config.js';
import { contentSecurityPolicy } from '../server/security.js';

const shipped = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as SampanConfig;
const clone = (): SampanConfig => structuredClone(shipped);
const clientPath = fileURLToPath(new URL(`../web/public${shipped.atom.clientUrl}`, import.meta.url));
const clientBytes = readFileSync(clientPath);

interface ClientConfig {
  evm: { atomLock: string; rpcUrls: string[] };
  electrum: { servers: string[] };
}

const connectSrc = (c: SampanConfig): string[] => /connect-src ([^;]+)/.exec(contentSecurityPolicy(c))![1]!.split(' ');

describe('atom client file', () => {
  it('has the sha256 that config names', () => {
    expect(createHash('sha256').update(clientBytes).digest('hex')).toBe(shipped.atom.clientSha256);
  });

  it('carries the AtomLock address that config names', () => {
    // A boolean, so a failure does not print the whole 1.6 MB file.
    expect(clientBytes.toString('utf8').includes(shipped.atom.atomLock), `client contains ${shipped.atom.atomLock}`).toBe(true);
  });

  it('is named after the commit it was built from', () => {
    expect(shipped.atom.clientUrl).toBe(`/vendor/atom-client-${shipped.atom.clientCommit.slice(0, 7)}.js`);
  });

  it('only needs servers that atom.connect lists', async () => {
    const client = (await import(clientPath)) as { shippedConfig(): ClientConfig };
    const built = client.shippedConfig();
    expect(built.evm.atomLock).toBe(shipped.atom.atomLock);
    const needed = [...built.electrum.servers, ...built.evm.rpcUrls].map((u) => new URL(u).origin);
    const listed = shipped.atom.connect.map((u) => new URL(u).origin);
    for (const origin of needed) expect(listed).toContain(origin);
  });
});

describe('atom config', () => {
  it('ships switched off, with no flow offered', () => {
    expect(validateConfig(shipped)).toEqual([]);
    expect(typeof shipped.features.atom).toBe('boolean');
    expect(shipped.atom.flows.every((f) => f === 'usdc-to-pusd' || f === 'pusd-to-usdc')).toBe(true);
  });

  it('rejects a changed client name, commit, hash, contract or flow', () => {
    const cases: [string, (c: SampanConfig) => void][] = [
      ['clientUrl', (c) => (c.atom.clientUrl = '/atom/client.js')],
      ['clientUrl', (c) => (c.atom.clientUrl = '/vendor/atom-client-0000000.js')],
      ['clientCommit', (c) => (c.atom.clientCommit = 'abc')],
      ['clientSha256', (c) => (c.atom.clientSha256 = c.atom.clientSha256.toUpperCase())],
      ['atomLock', (c) => (c.atom.atomLock = '0x1234')],
      ['flows', (c) => (c.atom.flows = ['usdc-to-pusd', 'usdc-to-pusd'])],
      ['flows', (c) => (c.atom.flows = ['bch-to-usdc' as never])],
      ['connect', (c) => (c.atom.connect = ['http://mainnet.base.org'])],
      ['healthTimeoutMs', (c) => (c.atom.healthTimeoutMs = 0)],
    ];
    for (const [field, change] of cases) {
      const c = clone();
      change(c);
      expect(validateAtom(c.atom).join(), field).toMatch(new RegExp(`atom.${field}`));
    }
    const c = clone();
    (c.features as Record<string, unknown>).atom = 'yes';
    expect(validateConfig(c).join()).toMatch(/features.atom/);
  });

  it('sends the block to the page through /api/config', () => {
    expect(publicConfig(shipped).atom).toEqual(shipped.atom);
  });
});

describe('connect-src', () => {
  it('leaves out every atom server while features.atom is false', () => {
    const c = clone();
    c.features.atom = false;
    const allowed = connectSrc(c);
    for (const u of c.atom.connect) {
      const origin = new URL(u).origin;
      // An origin Sampan already needs for its own route stays; the atom-only ones must not appear.
      if (!c.evm.chains.some((ch) => new URL(ch.rpc).origin === origin)) expect(allowed).not.toContain(origin);
    }
    expect(atomConnectOrigins(false, c.atom)).toEqual([]);
  });

  it('adds every atom.connect origin while features.atom is true', () => {
    const c = clone();
    c.features.atom = true;
    const allowed = connectSrc(c);
    for (const u of c.atom.connect) expect(allowed).toContain(new URL(u).origin);
  });
});
