// The in-process finisher on the fake chain: a payment seen through the subscription converts with no kick, an
// impossible rate gives the BCH back once the coin is old enough, quiet addresses stop being watched, and a new
// process picks up where the old one stopped, and a dropped conversion is made again.
import { binToHex } from '@bitauth/libauth';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import shipped from '../../config/sampan.json' with { type: 'json' };
import { normalizeConfig, type SampanConfig } from '../../core/config.js';
import { makeCard } from '../../core/landing-card.js';
import { LANDING_RATE_DEN, landingLockingHex, rateNumFor, type LandingParams } from '../../core/landing.js';
import { poolV0LockingHex } from '../../core/pools/template.js';
import { PUSD, pools, userLock } from '../../tests/helpers/pools.js';
import { FakeChain } from '../chain/fake.js';
import { Db } from '../db.js';
import { refreshPools } from '../pools.js';
import { LandingWatcher } from './watcher.js';

const config = normalizeConfig(shipped as unknown as SampanConfig);
const SATS = 100_000n;
const DAY = 86_400_000;
const params = (tokensMin: bigint): LandingParams => ({
  ownerLockHex: binToHex(userLock),
  category: PUSD,
  rateNum: rateNumFor(tokensMin, SATS),
  rateDen: LANDING_RATE_DEN,
  returnAfter: config.landing.returnAfterBlocks,
});

let chain: FakeChain;
let dir: string;
let db: Db;
let clock: number;
const watchers: LandingWatcher[] = [];

const watcher = (d: Db = db): LandingWatcher => {
  const w = new LandingWatcher({ config, db: d, chain, loadPools: () => refreshPools(chain, pools), now: () => clock });
  watchers.push(w);
  return w;
};

const open = (p: LandingParams): { id: string; lock: string } => {
  const card = makeCard(p, { network: 'mainnet', token: 'PUSD', created: new Date(clock) });
  const id = db.createCrossing({ kind: 'land', status: 'open', asset: 'PUSD', amount: '50000', address: card.ownerAddress, depositAddress: card.address, origin: 'public' });
  db.createLanding({ address: card.address, crossingId: id, card });
  return { id, lock: landingLockingHex(p) };
};

const pay = (lock: string, height = 0): void =>
  chain.add(lock, { txid: 'ab'.repeat(32), vout: 0, sats: SATS, height });

/** Lets queued microtasks (the subscription callback and the finish it starts) run to the end. Starts nothing. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  chain = new FakeChain();
  for (const p of pools)
    chain.add(poolV0LockingHex(p.ownerPkh), { txid: p.txid, vout: p.vout, sats: p.sats, height: 1, token: { category: PUSD, amount: p.tokens } });
  dir = mkdtempSync(path.join(tmpdir(), 'sampan-watch-'));
  db = new Db(path.join(dir, 'sampan.db'), () => clock);
  clock = Date.UTC(2026, 10, 16);
});
afterEach(() => {
  for (const w of watchers.splice(0)) w.stop();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('landing watcher', () => {
  it('converts a payment as soon as the subscription reports it, without a kick', async () => {
    const { id, lock } = open(params(1n));
    const w = watcher();
    await w.tick();
    expect(chain.watching(lock)).toBe(1);
    clock += 5_000;
    pay(lock);
    expect(db.getCrossing(id)!.status).toBe('open');
    await settle();
    const c = db.getCrossing(id)!;
    expect(c.status).toBe('converted');
    expect(c.txid).toMatch(/^[0-9a-f]{64}$/);
    const l = db.landingOf(id)!;
    expect(l.utxo).toBe(`${'ab'.repeat(32)}:0`);
    expect(l.finish_txid).toBe(c.txid);
    const owner = await chain.listUnspent(binToHex(userLock));
    expect(owner.some((u) => u.token?.category === PUSD && u.token.amount > 0n)).toBe(true);
    expect(db.stats('public').completed).toBe(1);
  });

  it('converts again when the first conversion was dropped and the coin is back at the address (ADR 0080)', async () => {
    const { id, lock } = open(params(1n));
    const w = watcher();
    pay(lock);
    await w.tick();
    const first = db.getCrossing(id)!.txid;
    expect(db.getCrossing(id)!.status).toBe('converted');
    // The network kept another spend of the pool coin: the conversion is gone and the payment is unspent again.
    pay(lock);
    clock += 60_000;
    await w.tick();
    const c = db.getCrossing(id)!;
    expect(c.status).toBe('converted');
    expect(c.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(c.txid).not.toBe(first);
    expect(await chain.transaction(c.txid!)).not.toBeNull();
    expect(db.landingOf(id)!.finish_txid).toBe(c.txid);
    expect(await chain.listUnspent(lock)).toEqual([]);
  });

  it('waits while the rate cannot be met, then gives the BCH back after returnAfterBlocks', async () => {
    const { id, lock } = open(params(1_000_000n));
    const w = watcher();
    pay(lock, chain.height);
    await w.tick();
    expect(db.getCrossing(id)!.status).toBe('seen');
    expect(db.getCrossing(id)!.error).toMatch(/giveBack possible in/);
    chain.height += config.landing.returnAfterBlocks;
    await w.tick();
    const c = db.getCrossing(id)!;
    expect(c.status).toBe('returned');
    expect((await chain.listUnspent(binToHex(userLock))).some((u) => !u.token && u.sats > SATS - 1000n)).toBe(true);
    expect(db.stats('public').returned).toBe(1);
  });

  it('stops watching an address that received nothing for idleDays, and the kick then refuses it', async () => {
    const { id, lock } = open(params(1n));
    const w = watcher();
    await w.tick();
    clock += (config.landing.idleDays - 1) * DAY;
    await w.tick();
    expect(db.landingOf(id)!.status).toBe('watching');
    clock += 2 * DAY;
    await w.tick();
    expect(db.landingOf(id)!.status).toBe('idle');
    expect(chain.watching(lock)).toBe(0);
    expect(await w.kick(id)).toBe(false);
  });

  it('resumes after a restart: a new process watches and finishes what the old one left', async () => {
    const { id, lock } = open(params(1n));
    const first = watcher();
    await first.tick();
    first.stop();
    expect(chain.watching(lock)).toBe(0);
    pay(lock);
    db.close();
    db = new Db(path.join(dir, 'sampan.db'), () => clock);
    const second = watcher(db);
    await second.tick();
    expect(second.watching).toBe(1);
    expect(db.getCrossing(id)!.status).toBe('converted');
  });

  it('records a chain failure on the crossing and keeps watching', async () => {
    const { id, lock } = open(params(1n));
    const w = watcher();
    pay(lock);
    const real = chain.listUnspent.bind(chain);
    chain.listUnspent = async (l: string) => {
      if (l === lock) throw new Error('server went away');
      return real(l);
    };
    await w.tick();
    const c = db.getCrossing(id)!;
    expect(c.error).toBe('server went away');
    expect(c.status).toBe('open');
    expect(db.landingOf(id)!.status).toBe('watching');
  });
});
