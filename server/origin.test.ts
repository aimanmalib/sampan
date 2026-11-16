import { encodeCashAddress } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
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

  it('reads extra team addresses from SAMPAN_TEST_ADDRESSES', () => {
    expect(readEnv({ SAMPAN_TEST_ADDRESSES: ` ${plain(1)}, ,${plain(2)} ` }, '/x').testAddresses).toEqual([plain(1), plain(2)]);
    expect(readEnv({}, '/x').testAddresses).toEqual([]);
  });
});
