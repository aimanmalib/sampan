// The atomic swap run's own logic (web/src/atom/run.ts) against a stand-in client: the lock waits for the recovery
// card, the claim goes out only after the page's own check of the maker's lock, once, the PUSD payment also waits for
// the card, the refund opens only after the lock's time on the chain's clock, and every stop has a code.
import { describe, expect, it } from 'vitest';
import type { AtomDeps, AtomSaved, AtomShippedConfig, AtomSwapModule, AtomSwapView } from '../web/src/atom/client.js';
import { atomDeps, CardFirst, cardFile, codeOf, lockUsdc, offerProblem, payPusd, refundLock, refundOpenNow, shortAmount, tick } from '../web/src/atom/run.js';

const HASH = 'ab'.repeat(32);
const shipped: AtomShippedConfig = {
  features: { mainnet: true },
  evm: { chainId: 8453, atomLock: '0x195748691cBD8f47794d03f2992Bc988314af7C3', rpcUrls: ['https://rpc.test'] },
  bch: { network: 'mainnet' },
  electrum: { servers: ['wss://main.test'], chipnetServers: ['wss://chip.test'], timeoutMs: 5 },
  client: { apiPath: '/atom/api', pollSeconds: 10, storageKey: 'sampan-atom-cards' },
  tokens: { pusd: { symbol: 'PUSD' }, usdc: { symbol: 'USDC' } },
};
const saved: AtomSaved = { card: { flow: 'usdc-to-pusd', createdUtc: '2026-11-17T08:00:00.000Z', secret: { hash: HASH }, user: { chain: 'base' } }, amountOut: 200n };
const savedOut: AtomSaved = { card: { flow: 'pusd-to-usdc', createdUtc: '2026-11-17T08:00:00.000Z', secret: { hash: HASH }, user: { chain: 'bch' } }, amountOut: 200n };
const REQUEST = { address: 'bitcoincash:rcontract', tokenAmount: '2.000000', tokenUnits: 2_000_000n, category: 'cd'.repeat(32), sats: 2000n };
const view = (state: AtomSwapView['state'], tx: AtomSwapView['tx'] = {}): AtomSwapView => ({
  hash: HASH, flow: 'usdc-to-pusd', state, amountIn: '2', amountOut: '2', symbolIn: 'USDC', symbolOut: 'PUSD', lockBy: 0, makerLock: {}, declined: null, tx,
});

interface Calls {
  lock: number;
  claim: number;
  electrum: string[];
  relayRefund: number;
  walletRefund: number;
}

interface FakeOpts {
  swaps: AtomSwapView[];
  ready?: (string | null)[];
  claimFails?: boolean;
  refundOpen?: boolean | 'throws';
  relayFails?: boolean;
}

function fake(opts: FakeOpts): { client: AtomSwapModule; deps: AtomDeps; calls: Calls } {
  const calls: Calls = { lock: 0, claim: 0, electrum: [], relayRefund: 0, walletRefund: 0 };
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
    paymentRequest: () => REQUEST,
    refundReady: () => (opts.refundOpen === 'throws' ? Promise.reject(new Error('no BCH server answered')) : Promise.resolve(opts.refundOpen ?? false)),
    refundByRelay: () => {
      calls.relayRefund += 1;
      return opts.relayFails ? Promise.reject(Object.assign(new Error('x'), { reason: 'offline' })) : Promise.resolve(view('refunded'));
    },
    refundWithWallet: () => {
      calls.walletRefund += 1;
      return Promise.resolve('0xrefund');
    },
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

  it('pays the contract for PUSD to USDC only after the card was downloaded, with the client request untouched', async () => {
    const { client, deps } = fake({ swaps: [] });
    const paid: unknown[] = [];
    const pay = (r: unknown) => {
      paid.push(r);
      return Promise.resolve('bb'.repeat(32));
    };
    await expect(payPusd(client, deps, savedOut, new Set(), pay)).rejects.toBeInstanceOf(CardFirst);
    expect(paid).toEqual([]);
    await expect(payPusd(client, deps, savedOut, new Set([HASH]), pay)).resolves.toBe('bb'.repeat(32));
    expect(paid).toEqual([REQUEST]);
  });

  it('opens the refund only after the time to lock and on the chain clock, never for a final or unlocked swap', async () => {
    const late = { ...view('userLocked'), lockBy: 100 };
    const open = fake({ swaps: [], refundOpen: true });
    expect(await refundOpenNow(open.client, open.deps, saved, late, 101)).toBe(true);
    expect(await refundOpenNow(open.client, open.deps, saved, late, 100)).toBe(false);
    expect(await refundOpenNow(open.client, open.deps, saved, { ...late, state: 'done' }, 101)).toBe(false);
    expect(await refundOpenNow(open.client, open.deps, saved, { ...late, state: 'offered' }, 101)).toBe(false);
    expect(await refundOpenNow(open.client, open.deps, saved, { ...late, tx: { userRefund: 'aa' } }, 101)).toBe(false);
    const shut = fake({ swaps: [], refundOpen: false });
    expect(await refundOpenNow(shut.client, shut.deps, saved, late, 101)).toBe(false);
    const down = fake({ swaps: [], refundOpen: 'throws' });
    expect(await refundOpenNow(down.client, down.deps, saved, late, 101)).toBe(false);
  });

  it('refunds through the relay, and on Base through the wallet only when the relay fails', async () => {
    const wallet = { request: () => Promise.resolve(null) };
    const ok = fake({ swaps: [] });
    expect(await refundLock(ok.client, ok.deps, saved, wallet)).toMatchObject({ state: 'refunded' });
    expect([ok.calls.relayRefund, ok.calls.walletRefund]).toEqual([1, 0]);
    const relayDown = fake({ swaps: [], relayFails: true });
    expect(await refundLock(relayDown.client, relayDown.deps, saved, wallet)).toBeNull();
    expect([relayDown.calls.relayRefund, relayDown.calls.walletRefund]).toEqual([1, 1]);
    const bchSide = fake({ swaps: [], relayFails: true });
    await expect(refundLock(bchSide.client, bchSide.deps, savedOut, wallet)).rejects.toMatchObject({ reason: 'offline' });
    await expect(refundLock(bchSide.client, bchSide.deps, saved, null)).rejects.toMatchObject({ reason: 'offline' });
    expect(bchSide.calls.walletRefund).toBe(0);
  });
});
