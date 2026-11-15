import { binToHex } from '@bitauth/libauth';
import { beforeEach, describe, expect, it } from 'vitest';
import { PUSD, pools, userLock } from '../../tests/helpers/pools.js';
import { LANDING_RATE_DEN, landingLockingHex, rateNumFor, type LandingParams } from '../../core/landing.js';
import { poolV0LockingHex } from '../../core/pools/template.js';
import type { PoolUtxo } from '../../core/pools/trade.js';
import { FakeChain } from '../chain/fake.js';
import { refreshPools } from '../pools.js';
import { blocksUntilReturn, finishLanding, type FinishDeps } from './finish.js';

const SATS = 100_000n;
const params = (tokensMin: bigint): LandingParams => ({
  ownerLockHex: binToHex(userLock),
  category: PUSD,
  rateNum: rateNumFor(tokensMin, SATS),
  rateDen: LANDING_RATE_DEN,
  returnAfter: 6,
});
const EASY = params(1n);
const IMPOSSIBLE = params(1_000_000n);

let chain: FakeChain;
const deps = (over: Partial<FinishDeps> = {}): FinishDeps => ({
  chain,
  loadPools: () => refreshPools(chain, pools),
  maxPools: 3,
  satsPerByte: 1n,
  tokenDustSats: 1000n,
  attempts: 5,
  ...over,
});
const land = (p: LandingParams, height = 0, token = false) =>
  chain.add(landingLockingHex(p), {
    txid: (chain.height + height).toString(16).padStart(64, 'a'),
    vout: 0,
    sats: SATS,
    height,
    ...(token ? { token: { category: PUSD, amount: 5n } } : {}),
  });

beforeEach(() => {
  chain = new FakeChain();
  for (const p of pools) chain.add(poolV0LockingHex(p.ownerPkh), { txid: p.txid, vout: p.vout, sats: p.sats, height: 1, token: { category: PUSD, amount: p.tokens } });
});

describe('finishLanding', () => {
  it('converts a coin and pays the tokens to the owner', async () => {
    land(EASY);
    const [r] = await finishLanding(EASY, deps());
    expect(r!.action).toBe('converted');
    expect(await chain.listUnspent(landingLockingHex(EASY))).toHaveLength(0);
    const owner = await chain.listUnspent(binToHex(userLock));
    expect(owner.some((u) => u.token?.category === PUSD && u.token.amount > 0n)).toBe(true);
  });

  it('rebuilds with fresh pools when a pool was spent before broadcast', async () => {
    land(EASY);
    let calls = 0;
    const stale: PoolUtxo[] = pools.map((p) => ({ ...p, txid: `ff${p.txid.slice(2)}` }));
    const [r] = await finishLanding(EASY, deps({ loadPools: async () => (calls++ === 0 ? stale : refreshPools(chain, pools)) }));
    expect(r).toMatchObject({ action: 'converted' });
    expect(calls).toBe(2);
  });

  it('waits while the minimum cannot be met and the coin is young', async () => {
    land(IMPOSSIBLE, chain.height - 2);
    const [r] = await finishLanding(IMPOSSIBLE, deps());
    expect(r).toMatchObject({ action: 'waiting' });
    expect(r!.action === 'waiting' && r!.reason).toMatch(/contract needs at least .*giveBack possible in 3 more block/);
  });

  it('gives the BCH back once the coin is returnAfter blocks old', async () => {
    land(IMPOSSIBLE, chain.height - 5);
    const [r] = await finishLanding(IMPOSSIBLE, deps());
    expect(r!.action).toBe('returned');
    const back = await chain.listUnspent(binToHex(userLock));
    expect(back).toHaveLength(1);
    expect(back[0]!.token).toBeUndefined();
    expect(back[0]!.sats).toBeGreaterThanOrEqual(SATS - 1000n);
  });

  it('convert mode never returns, giveBack mode never converts', async () => {
    land(EASY, chain.height - 10);
    expect((await finishLanding(EASY, deps({ dryRun: true }), 'giveBack'))[0]!.action).toBe('returned');
    land(IMPOSSIBLE, chain.height - 10);
    expect((await finishLanding(IMPOSSIBLE, deps(), 'convert'))[0]!.action).toBe('waiting');
  });

  it('leaves coins that carry tokens alone', async () => {
    land(EASY, 0, true);
    expect((await finishLanding(EASY, deps()))[0]).toMatchObject({ action: 'skipped' });
  });
});

describe('blocksUntilReturn', () => {
  it('counts from the block the coin was mined in', () => {
    const coin = { txid: '', vout: 0, sats: 1n, height: 100 };
    expect(blocksUntilReturn(coin, 100, 6)).toBe(5);
    expect(blocksUntilReturn(coin, 105, 6)).toBe(0);
    expect(blocksUntilReturn({ ...coin, height: 0 }, 500, 6)).toBe(6);
  });
});
