// The atomic swap run's own logic (web/src/atom/run.ts) against a stand-in client: the lock waits for the recovery
// card, the claim goes out only after the page's own check of the maker's lock, once, and every stop has a code.
import { describe, expect, it } from 'vitest';
import type { AtomDeps, AtomSaved, AtomShippedConfig, AtomSwapModule, AtomSwapView } from '../web/src/atom/client.js';
import { atomDeps, CardFirst, cardFile, codeOf, lockUsdc, offerProblem, shortAmount, tick } from '../web/src/atom/run.js';

const HASH = 'ab'.repeat(32);
const shipped: AtomShippedConfig = {
  features: { mainnet: true },
  evm: { chainId: 8453, atomLock: '0x195748691cBD8f47794d03f2992Bc988314af7C3', rpcUrls: ['https://rpc.test'] },
  bch: { network: 'mainnet' },
  electrum: { servers: ['wss://main.test'], chipnetServers: ['wss://chip.test'], timeoutMs: 5 },
  client: { apiPath: '/atom/api', pollSeconds: 10, storageKey: 'sampan-atom-cards' },
  tokens: { pusd: { symbol: 'PUSD' }, usdc: { symbol: 'USDC' } },
};
const saved: AtomSaved = { card: { flow: 'usdc-to-pusd', createdUtc: '2026-11-17T08:00:00.000Z', secret: { hash: HASH } }, amountOut: 200n };
const view = (state: AtomSwapView['state'], tx: AtomSwapView['tx'] = {}): AtomSwapView => ({
  hash: HASH, flow: 'usdc-to-pusd', state, amountIn: '2', amountOut: '2', symbolIn: 'USDC', symbolOut: 'PUSD', lockBy: 0, makerLock: {}, declined: null, tx,
});

interface Calls {
  lock: number;
  claim: number;
  electrum: string[];
}

function fake(opts: { swaps: AtomSwapView[]; ready?: (string | null)[]; claimFails?: boolean }): { client: AtomSwapModule; deps: AtomDeps; calls: Calls } {
  const calls: Calls = { lock: 0, claim: 0, electrum: [] };
  const swaps = [...opts.swaps];
  const ready = [...(opts.ready ?? [])];
  const api = {
    health: () => Promise.reject(new Error('not used')),
    quote: () => Promise.reject(new Error('not used')),
    swap: () => Promise.resolve(swaps.shift() ?? view('done')),
  };
  const client = {
    shippedConfig: () => shipped,
    makerApi: () => api,
    baseReader: () => ({}),
    connectElectrum: (servers: string[]) => {
      calls.electrum.push(...servers);
      return Promise.resolve({});
    },
    cardStore: () => ({ list: () => [] }),
    cardToJson: () => '{"card":1}',
    startSwap: () => Promise.reject(new Error('not used')),
    lockOnBase: () => {
      calls.lock += 1;
      return Promise.resolve('0xlock');
    },
    makerLockReady: () => Promise.resolve(ready.shift() ?? null),
    claim: () => {
      calls.claim += 1;
      return opts.claimFails ? Promise.reject(Object.assign(new Error('x'), { reason: 'relay-busy' })) : Promise.resolve(view('secretSeen'));
    },
    refundReady: () => Promise.resolve(false),
    amountInText: () => '2',
    amountOutText: () => '2',
  } satisfies AtomSwapModule;
  const store = { getItem: () => null, setItem: () => undefined };
  return { client, deps: atomDeps(client, shipped, '/atom/api', store), calls };
}

describe('atom run', () => {
  it('refuses to lock before this swap card was downloaded, and locks after', async () => {
    const { client, deps, calls } = fake({ swaps: [] });
    await expect(lockUsdc(client, deps, saved, new Set(), { request: () => Promise.resolve(null) }, () => undefined)).rejects.toBeInstanceOf(CardFirst);
    await expect(lockUsdc(client, deps, saved, new Set(['other']), { request: () => Promise.resolve(null) }, () => undefined)).rejects.toThrow('card-first');
    expect(calls.lock).toBe(0);
    await expect(lockUsdc(client, deps, saved, new Set([HASH]), { request: () => Promise.resolve(null) }, () => undefined)).resolves.toBe('0xlock');
    expect(calls.lock).toBe(1);
  });

  it('claims once, only after the maker lock passes, and keeps waiting while it is not confirmed', async () => {
    const { client, deps, calls } = fake({ swaps: [view('userLocked'), view('makerLocked'), view('makerLocked'), view('makerLocked')], ready: ['not-confirmed', null] });
    const claimed = new Set<string>();
    expect(await tick(client, deps, saved, claimed)).toMatchObject({ activity: null, problem: null, final: false });
    expect(await tick(client, deps, saved, claimed)).toMatchObject({ activity: 'checking', problem: null });
    expect(calls.claim).toBe(0);
    expect(await tick(client, deps, saved, claimed)).toMatchObject({ activity: 'claiming', swap: { state: 'secretSeen' } });
    expect(await tick(client, deps, saved, claimed)).toMatchObject({ activity: null });
    expect(calls.claim).toBe(1);
  });

  it('stops without claiming when the maker lock fails a check, and frees a failed claim for the next poll', async () => {
    const bad = fake({ swaps: [view('makerLocked')], ready: ['wrong-recipient'] });
    expect(await tick(bad.client, bad.deps, saved, new Set())).toMatchObject({ problem: 'wrong-recipient' });
    expect(bad.calls.claim).toBe(0);
    const busy = fake({ swaps: [view('makerLocked')], claimFails: true });
    const claimed = new Set<string>();
    expect(await tick(busy.client, busy.deps, saved, claimed)).toMatchObject({ problem: 'relay-busy' });
    expect(claimed.size).toBe(0);
  });

  it('marks final states and skips the claim step once the claim is on chain', async () => {
    const { client, deps, calls } = fake({ swaps: [view('makerLocked', { userClaim: 'aa' }), view('done')] });
    expect(await tick(client, deps, saved, new Set())).toMatchObject({ final: false });
    expect(await tick(client, deps, saved, new Set())).toMatchObject({ final: true });
    expect(calls.claim).toBe(0);
  });

  it('reads Electrum servers for the network the client was built for, and names the card file by hash', async () => {
    const { client, deps, calls } = fake({ swaps: [] });
    await deps.bch();
    expect(calls.electrum).toEqual(['wss://main.test']);
    const chip = atomDeps(client, { ...shipped, bch: { network: 'chipnet' } }, '/atom/api', { getItem: () => null, setItem: () => undefined });
    await chip.bch();
    expect(calls.electrum).toEqual(['wss://main.test', 'wss://chip.test']);
    expect(cardFile(client, saved)).toEqual({ name: `sampan-recovery-${HASH.slice(0, 12)}.json`, text: '{"card":1}' });
  });

  it('turns errors into short codes', () => {
    expect(codeOf({ reason: 'inventory' })).toBe('inventory');
    expect(codeOf({ code: 4001, message: 'User rejected' })).toBe('rejected');
    expect(codeOf(new Error('wrong-contract'))).toBe('wrong-contract');
    expect(codeOf(new Error('more than 6 decimal places: 1.1234567'))).toBe('other');
    expect(codeOf(null)).toBe('other');
    expect(offerProblem('wrong-contract')).toBe(true);
    expect(offerProblem('inventory')).toBe(false);
    expect([shortAmount('2.000000'), shortAmount('1.98'), shortAmount('10'), shortAmount('0.50')]).toEqual(['2', '1.98', '10', '0.5']);
  });
});
