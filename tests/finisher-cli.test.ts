import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCard } from '../core/landing-card.js';
import { landingLockingHex } from '../core/landing.js';
import { poolV0LockingHex } from '../core/pools/template.js';
import { FakeChain } from '../server/chain/fake.js';
import { loadConfig } from '../server/config.js';
import { run, USAGE, type FinisherDeps } from '../scripts/finisher-cli.js';
import { fixture, pools } from './helpers/pools.js';

const CARD_PATH = fileURLToPath(new URL('./fixtures/landing-card.json', import.meta.url));
const CARD_JSON = readFileSync(CARD_PATH, 'utf8');
const config = loadConfig(fileURLToPath(new URL('../config/sampan.json', import.meta.url)));
const read = readCard(JSON.parse(CARD_JSON));
if (typeof read === 'string') throw new Error(read);
const { card, params } = read;

let chain: FakeChain;
let out: string[];
let errs: string[];
let hosts: string[];
let fetched: string[];

const deps = (over: Partial<FinisherDeps> = {}): FinisherDeps => ({
  config,
  readFile: (p) => (p === 'card.json' ? CARD_JSON : readFileSync(p, 'utf8')),
  makeChain: (servers) => {
    hosts.push(...servers);
    return chain;
  },
  fetchActive: async (indexer, category) => {
    hosts.push(indexer);
    expect(category).toBe(card.category);
    return fixture.active;
  },
  log: (l) => out.push(l),
  err: (l) => errs.push(l),
  ...over,
});

beforeEach(() => {
  chain = new FakeChain();
  for (const p of pools) chain.add(poolV0LockingHex(p.ownerPkh), { txid: p.txid, vout: p.vout, sats: p.sats, height: 1, token: { category: p.category, amount: p.tokens } });
  chain.add(landingLockingHex(params), { txid: 'ab'.repeat(32), vout: 0, sats: 100_000n, height: chain.height - 1 });
  out = [];
  errs = [];
  hosts = [];
  fetched = [];
  // Any direct HTTP call (for example to the Sampan site or its API) is recorded and fails.
  vi.stubGlobal('fetch', async (url: unknown) => {
    fetched.push(String(url));
    throw new Error('network is not allowed in this test');
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('finisher CLI', () => {
  it('prints the usage with --help and exits 0', async () => {
    expect(await run(['--help'], deps())).toBe(0);
    expect(out.join('\n')).toBe(USAGE);
    expect(USAGE).toMatch(/without the Sampan server/);
  });

  it.each([[[]], [['a.json', 'b.json']], [['card.json', '--fast']], [['card.json', '--convert', '--give-back']]])(
    'exits 2 with the usage for %j',
    async (argv) => {
      expect(await run(argv, deps())).toBe(2);
      expect(errs.join('\n')).toBe(USAGE);
      expect(hosts).toEqual([]);
    },
  );

  it('exits 1 on a damaged card and contacts nobody', async () => {
    const bad = JSON.stringify({ ...JSON.parse(CARD_JSON), rateNum: '999' });
    expect(await run(['bad.json'], deps({ readFile: () => bad }))).toBe(1);
    expect(errs[0]).toMatch(/card rejected: .*address does not match/);
    expect(await run(['missing.json'], deps({ readFile: () => { throw new Error('ENOENT'); } }))).toBe(1);
    expect(errs[1]).toMatch(/card rejected: cannot read missing.json/);
    expect(hosts).toEqual([]);
  });

  it('builds a conversion with --dry-run that the contract accepts, without broadcasting', async () => {
    const broadcast = vi.spyOn(chain, 'broadcast');
    expect(await run(['card.json', '--dry-run'], deps())).toBe(0);
    expect(errs).toEqual([]);
    expect(out[0]).toBe(`landing ${card.address} -> ${card.ownerAddress} (auto, dry run)`);
    expect(out[1]).toMatch(/: converted, txid \(dry run\), fee \d+ sats\n[0-9a-f]+$/);
    const tx = decodeTransaction(hexToBin(out[1]!.split('\n')[1]!));
    if (typeof tx === 'string') throw new Error(tx);
    expect(binToHex(tx.outputs[0]!.lockingBytecode)).toBe(card.ownerLockHex);
    expect(binToHex(tx.outputs[0]!.token!.category)).toBe(card.category);
    // finishLanding runs the VM on every transaction it builds; nothing reached the chain.
    expect(broadcast).not.toHaveBeenCalled();
    expect(await chain.listUnspent(landingLockingHex(params))).toHaveLength(1);
  });

  it('contacts only the configured Electrum servers and Cauldron indexers, never the Sampan site', async () => {
    expect(await run(['card.json'], deps())).toBe(0);
    expect(out[1]).toMatch(/: converted, txid [0-9a-f]{64}/);
    const allowed = new Set([...config.electrum.servers, ...config.cauldron.indexers]);
    expect(hosts.length).toBeGreaterThan(0);
    for (const h of hosts) expect(allowed.has(h)).toBe(true);
    const site = new URL(config.site.url).host;
    for (const h of [...hosts, ...fetched]) {
      expect(h).not.toContain(site);
      expect(h).not.toContain('/api/');
    }
    expect(fetched).toEqual([]);
  });
});
