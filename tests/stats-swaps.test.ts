import { describe, expect, it } from 'vitest';
import { Db } from '../server/db.js';

const TXID = 'ab'.repeat(32);

describe('/api/stats swap count', () => {
  it('counts broadcast swaps by origin, apart from landings and crossings', () => {
    const db = new Db(':memory:');
    const swap = (origin: 'test' | 'public', patch: { status: string; txid?: string }) => {
      const id = db.createCrossing({ kind: 'swap', status: 'built', asset: 'PUSD', amount: '1', address: 'bitcoincash:zx', origin });
      db.updateCrossing(id, patch);
    };
    swap('public', { status: 'broadcast', txid: TXID });
    swap('test', { status: 'broadcast', txid: TXID });
    swap('public', { status: 'built' });
    swap('public', { status: 'stale' });
    swap('public', { status: 'failed' });
    db.createCrossing({ kind: 'land', status: 'converted', asset: 'PUSD', amount: '1', address: 'bitcoincash:zy', origin: 'public' });

    expect(db.stats('public')).toMatchObject({ swaps: 1, completed: 1 });
    expect(db.stats('test')).toMatchObject({ swaps: 1, completed: 0 });
    expect(db.stats()).toMatchObject({ swaps: 2, completed: 1 });
    db.close();
  });

  it('does not count a swap row with a broadcast status but no txid', () => {
    const db = new Db(':memory:');
    const id = db.createCrossing({ kind: 'swap', status: 'built', asset: 'PUSD', amount: '1', address: 'bitcoincash:zx', origin: 'public' });
    db.updateCrossing(id, { status: 'broadcast' });
    expect(db.stats('public').swaps).toBe(0);
    db.close();
  });
});
