// KAT3: the atomic swap route is offered only when /atom/api/health agrees with the client file and with Sampan's
// config; any other answer, a timeout or a client that fails to load leaves the route out with one short log line.
import { describe, expect, it } from 'vitest';
import type { PublicConfig } from '../core/config.js';
import type { AtomClientModule, AtomHealthView, AtomShippedConfig } from '../web/src/atom/client.js';
import { checkAtomRoute, healthProblem } from '../web/src/atom/health.js';
import { loadAtomClient } from '../web/src/atom/load.js';

const LOCK = '0x195748691cBD8f47794d03f2992Bc988314af7C3';
const shippedClient: AtomShippedConfig = {
  features: { mainnet: true },
  evm: { chainId: 8453, atomLock: LOCK, rpcUrls: ['https://mainnet.base.org'] },
  bch: { network: 'mainnet' },
  electrum: { servers: ['wss://bch.imaginary.cash:50004'], chipnetServers: [], timeoutMs: 8000 },
  client: { apiPath: '/atom/api', pollSeconds: 10, storageKey: 'sampan-atom-cards' },
  tokens: { pusd: { symbol: 'PUSD' }, usdc: { symbol: 'USDC' } },
};
const goodHealth: AtomHealthView = { ok: true, mainnet: true, bchNetwork: 'mainnet', chainId: 8453, atomLock: LOCK };

let n = 0;
function config(on = true): Pick<PublicConfig, 'features' | 'atom'> {
  n += 1;
  return {
    features: { musd: false, swap: true, landing: true, pay: true, atom: on, oneClick: false, nostrSend: false, watchDemo: false, keepCompare: false, demo: false, slides: false, headerBalance: false },
    atom: {
      // A new URL per test: the loader keeps one module per URL.
      clientUrl: `/vendor/atom-client-test${n}.min.js`,
      clientCommit: '1b6c6f704993a81b726b19dd4f51b9f1e97979e8',
      clientSha256: '0'.repeat(64),
      atomLock: LOCK,
      apiPath: '/atom/api',
      flows: [],
      healthTimeoutMs: 50,
      quotePauseMs: 600,
      pollSeconds: 10,
      connect: [],
    },
  };
}

function fakeClient(health: () => Promise<AtomHealthView>, shipped: () => AtomShippedConfig = () => shippedClient): { module: AtomClientModule; paths: string[] } {
  const paths: string[] = [];
  const module: AtomClientModule = {
    shippedConfig: shipped,
    makerApi: (base) => {
      paths.push(base);
      return { health, quote: () => Promise.reject(new Error('not used')) };
    },
  };
  return { module, paths };
}

async function run(health: () => Promise<AtomHealthView>, opts: { on?: boolean; importFails?: boolean; shipped?: () => AtomShippedConfig } = {}) {
  const logs: string[] = [];
  const imported: string[] = [];
  const { module, paths } = fakeClient(health, opts.shipped);
  const result = await checkAtomRoute(config(opts.on ?? true), {
    importer: (url) => {
      imported.push(url);
      return opts.importFails ? Promise.reject(new TypeError('Failed to fetch dynamically imported module')) : Promise.resolve(module);
    },
    log: (m) => logs.push(m),
  });
  return { result, logs, imported, paths };
}

describe('checkAtomRoute', () => {
  it('shows the route when the service agrees with the client and config', async () => {
    const { result, logs, paths } = await run(async () => goodHealth);
    expect(result.show).toBe(true);
    expect(logs).toEqual([]);
    expect(paths).toEqual(['/atom/api']);
  });

  it('accepts an AtomLock address that differs only in letter case', async () => {
    const { result } = await run(async () => ({ ...goodHealth, atomLock: LOCK.toLowerCase() }));
    expect(result.show).toBe(true);
  });

  it('loads nothing and asks nothing while features.atom is false', async () => {
    const { result, logs, imported, paths } = await run(async () => goodHealth, { on: false });
    expect(result).toEqual({ show: false, code: 'off' });
    expect(imported).toEqual([]);
    expect(paths).toEqual([]);
    expect(logs).toEqual([]);
  });

  const hidden: [string, () => Promise<AtomHealthView>, string][] = [
    ['another contract', async () => ({ ...goodHealth, atomLock: '0x0000000000000000000000000000000000000001' }), 'atom-lock'],
    ['not mainnet', async () => ({ ...goodHealth, mainnet: false }), 'not-mainnet'],
    ['another chain id', async () => ({ ...goodHealth, chainId: 84532 }), 'chain-id'],
    ['ok false', async () => ({ ...goodHealth, ok: false }), 'not-ok'],
    ['an error answer', () => Promise.reject(new Error('offline')), 'health-error'],
    ['no answer in time', () => new Promise<AtomHealthView>(() => {}), 'health-timeout'],
  ];
  for (const [label, health, code] of hidden) {
    it(`hides the route on ${label}`, async () => {
      const { result, logs } = await run(health);
      expect(result).toEqual({ show: false, code });
      expect(logs).toEqual([`atom route hidden: ${code}`]);
    });
  }

  it('hides the route when the client file fails to load', async () => {
    const { result, logs, paths } = await run(async () => goodHealth, { importFails: true });
    expect(result).toEqual({ show: false, code: 'client-load' });
    expect(logs).toEqual(['atom route hidden: client-load']);
    expect(paths).toEqual([]);
  });

  it('hides the route when the client was built for another contract than Sampan config names', async () => {
    const other = { ...shippedClient, evm: { ...shippedClient.evm, atomLock: '0x0000000000000000000000000000000000000002' } };
    const { result } = await run(async () => ({ ...goodHealth, atomLock: other.evm.atomLock }), { shipped: () => other });
    expect(result).toEqual({ show: false, code: 'atom-lock' });
  });

  it('hides the route when the client config is invalid', async () => {
    const { result } = await run(async () => goodHealth, {
      shipped: () => {
        throw new Error('invalid config');
      },
    });
    expect(result).toEqual({ show: false, code: 'client-config' });
  });
});

describe('healthProblem', () => {
  it('needs the health address to match both the client and the config', () => {
    expect(healthProblem(goodHealth, shippedClient, LOCK)).toBeNull();
    expect(healthProblem(goodHealth, shippedClient, '0x0000000000000000000000000000000000000003')).toBe('atom-lock');
  });
});

describe('loadAtomClient', () => {
  it('imports the file once and tries again after a failed load', async () => {
    const c = config();
    let calls = 0;
    const failing = () => {
      calls += 1;
      return Promise.reject(new Error('down'));
    };
    await expect(loadAtomClient(c, failing)).rejects.toThrow('down');
    await expect(loadAtomClient(c, failing)).rejects.toThrow('down');
    expect(calls).toBe(2);
    const ok = () => {
      calls += 1;
      return Promise.resolve(fakeClient(async () => goodHealth).module);
    };
    await loadAtomClient(c, ok);
    await loadAtomClient(c, ok);
    expect(calls).toBe(3);
  });
});
