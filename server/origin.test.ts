import { encodeCashAddress } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { buildProof, normalTxid, proofTxids } from '../core/proof.js';
import { Db } from './db.js';
import { readEnv } from './env.js';
import { markOwnRows, testLocksOf } from './origin.js';

const pkh = (byte: number): Uint8Array => new Uint8Array(20).fill(byte);
const plain = (byte: number): string => encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload: pkh(byte) }).address;
const tokenAware = (byte: number): string => encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkhWithTokens', payload: pkh(byte) }).address;

describe('team wallet rows', () => {
  it('moves rows made from a listed wallet to test, whichever address form the row used', () => {
    const db = new Db(':memory:');
    const row = (address: string, kind: 'land' | 'swap' = 'land') =>
      db.createCrossing({ kind, status: 'converted', asset: 'PUSD', amount: '1', address, origin: 'public' });
    const team = row(tokenAware(1));
    const teamSwap = row(plain(1), 'swap');
    const other = row(tokenAware(2));
    const locks = testLocksOf([plain(1), 'not an address'], 'bitcoincash');
    expect(locks.size).toBe(1);
    expect(markOwnRows(db, locks, 'bitcoincash')).toBe(2);
    expect(db.getCrossing(team)!.origin).toBe('test');
    expect(db.getCrossing(teamSwap)!.origin).toBe('test');
    expect(db.getCrossing(other)!.origin).toBe('public');
    expect(db.stats('public').completed).toBe(1);
    expect(db.stats('test').completed).toBe(1);
    expect(markOwnRows(db, locks, 'bitcoincash')).toBe(0);
    db.close();
  });

  it("moves rows whose txid is one of the team's measured runs, from any address, BCH or Base id", () => {
    const db = new Db(':memory:');
    const swap = (address: string, txid: string) => {
      const id = db.createCrossing({ kind: 'swap', status: 'built', asset: 'PUSD', amount: '1', address, origin: 'public' });
      db.updateCrossing(id, { status: 'broadcast', txid });
      return id;
    };
    const phone = swap(plain(7), 'AB'.repeat(32));
    const into = db.createCrossing({ kind: 'in', status: 'built', asset: 'USDC', amount: '1', address: plain(8), origin: 'public' });
    db.updateCrossing(into, { status: 'sent', txid: 'CD'.repeat(32) });
    const stranger = swap(plain(9), 'ef'.repeat(32));
    const team = new Set([normalTxid('ab'.repeat(32)), normalTxid(`0x${'cd'.repeat(32)}`)]);
    expect(markOwnRows(db, new Set(), 'bitcoincash', team)).toBe(2);
    expect(db.getCrossing(phone)!.origin).toBe('test');
    expect(db.getCrossing(into)!.origin).toBe('test');
    expect(db.getCrossing(stranger)!.origin).toBe('public');
    expect(db.stats('public').swaps).toBe(1);
    db.close();
  });

  it('takes every BCH and Base id from the Runs table of MEASURED.md', () => {
    const md = [
      '| UTC | flow | amount | txid | seconds | result |',
      '|---|---|---|---|---|---|',
      `| 2026-11-16T06:42:44Z | swap | 0.2 PUSD | ${'AB'.repeat(32)} | 9 | ok |`,
      `| 2026-11-16T07:00:00Z | out | 2 USD | bch ${'12'.repeat(32)} · base 0x${'CD'.repeat(32)} | 600 | ok |`,
      '| 2026-11-16T08:00:00Z | swap | 0.2 PUSD | - | - | fail |',
    ].join('\n');
    expect(proofTxids(buildProof(md)).sort()).toEqual(['ab'.repeat(32), '12'.repeat(32), 'cd'.repeat(32)].sort());
  });

  it('reads extra team addresses from SAMPAN_TEST_ADDRESSES', () => {
    expect(readEnv({ SAMPAN_TEST_ADDRESSES: ` ${plain(1)}, ,${plain(2)} ` }, '/x').testAddresses).toEqual([plain(1), plain(2)]);
    expect(readEnv({}, '/x').testAddresses).toEqual([]);
  });
});
