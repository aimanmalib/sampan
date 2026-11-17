// WalletConnect for EVM wallets (PRD 4.14): offered only when config has a project id, its relay is the only origin
// it adds to connect-src, and the page never imports the provider package statically (it is loaded on demand).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { publicConfig, validateConfig, type SampanConfig } from '../core/config.js';
import { contentSecurityPolicy } from '../server/security.js';
import { walletConnectOptions } from '../core/client/walletconnect.js';

const shipped = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as SampanConfig;
const ID = 'ab'.repeat(16);
const RELAY = 'wss://relay.example.org';
const VERIFY = 'https://verify.example.org';
const withWc = (projectId: string): SampanConfig => {
  const c = structuredClone(shipped);
  c.evm.walletConnectProjectId = projectId;
  c.evm.walletConnectRelay = RELAY;
  c.evm.walletConnectVerify = VERIFY;
  return c;
};
const connectSrc = (c: SampanConfig): string[] => /connect-src ([^;]+)/.exec(contentSecurityPolicy(c))![1]!.split(' ');

describe('WalletConnect config', () => {
  it('is not offered when the project id is empty', () => {
    expect(publicConfig(withWc('')).evm.walletConnect).toBeNull();
    expect(walletConnectOptions(publicConfig(withWc('')), 'n', 'd', 'https://x.test')).toBeNull();
  });

  it('gives the page the project id and relay when set', () => {
    expect(publicConfig(withWc(ID)).evm.walletConnect).toEqual({ projectId: ID, relayUrl: RELAY });
  });

  it('accepts only a 32 hex project id and a wss relay', () => {
    expect(validateConfig(withWc(ID))).toEqual([]);
    expect(validateConfig(withWc('not-an-id')).join()).toContain('evm.walletConnectProjectId');
    const c = withWc(ID);
    c.evm.walletConnectRelay = 'https://relay.example.org/path';
    c.evm.walletConnectVerify = 'http://verify.example.org';
    expect(validateConfig(c).join()).toContain('evm.walletConnectRelay');
    expect(validateConfig(c).join()).toContain('evm.walletConnectVerify');
  });

  it('pairs only on chains the route offers, with each chain first RPC', () => {
    const c = withWc(ID);
    c.thorchain.assets = c.thorchain.assets.map((a) => (a.chain === 'ETH' ? { ...a, live: { out: true, in: false } } : a));
    const o = walletConnectOptions(publicConfig(c), 'Sampan', 'About', 'https://x.test')!;
    const eth = c.evm.chains.find((ch) => ch.key === 'ETH')!;
    expect(o.chains).toEqual([{ id: eth.id, rpc: eth.rpc[0] }]);
    expect(o.metadata).toEqual({ name: 'Sampan', description: 'About', url: 'https://x.test', icons: ['https://x.test/favicon.svg'] });
  });
});

describe('WalletConnect in the CSP', () => {
  it('adds the relay origin only when a project id is set', () => {
    expect(connectSrc(withWc(''))).not.toContain(RELAY);
    expect(connectSrc(withWc(ID))).toContain(RELAY);
  });

  it('adds nothing else of the vendor to connect-src (no RPC, verify or analytics hosts)', () => {
    const added = connectSrc(withWc(ID)).filter((o) => !connectSrc(withWc('')).includes(o));
    expect(added).toEqual([RELAY]);
  });

  it('allows the Verify frame only when a project id is set, and no other frame', () => {
    expect(contentSecurityPolicy(withWc(''))).not.toContain('frame-src');
    expect(/frame-src ([^;]+)/.exec(contentSecurityPolicy(withWc(ID)))![1]).toBe(VERIFY);
  });
});

describe('WalletConnect loading', () => {
  const root = fileURLToPath(new URL('../web/src', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
    });
  const sources = files(root).map((p) => ({ p: path.relative(root, p), s: readFileSync(p, 'utf8') }));

  it('no page module imports a WalletConnect or Reown package statically', () => {
    const statics = sources.filter(({ s }) => /^import [^(]*['"]@(walletconnect|reown)\//m.test(s)).map(({ p }) => p);
    expect(statics).toEqual([]);
  });

  it('only the loader imports the provider, on demand', () => {
    const dynamic = sources.filter(({ s }) => s.includes("import('@walletconnect/ethereum-provider')")).map(({ p }) => p);
    expect(dynamic).toEqual([path.join('evm', 'walletconnect.ts')]);
  });
});
