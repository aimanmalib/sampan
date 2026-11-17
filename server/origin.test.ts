import { decodeCashAddress, encodeCashAddress } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { buildProof, normalTxid, proofTxids } from '../core/proof.js';
import { Db } from './db.js';
import { readEnv } from './env.js';
import { parseAddress } from '../core/address.js';
import { markOwnRows, ownKey, testLocksOf } from './origin.js';

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

  // The atomic swap route's maker and user test wallets (public on chain): two Base, two token-aware BCH addresses.
  const EVM_MAKER = '0xf7588BCe84186EBACF479527c7fdf8d569a8B13e';
  const EVM_USER = '0xA826721506212241213Ba824C06eB3EF4e2fF6BC';
  const BCH_MAKER = 'bitcoincash:zqjzsc3puptpy94r3p0e29msd6m7uedfeqdgn3v8g4';
  const BCH_USER = 'bitcoincash:zzdfhc43aa9sva7aqr044numgtyymcgqyq7u222fwe';
  const plainForm = (z: string): string => {
    const p = parseAddress(z, 'bitcoincash');
    if (typeof p === 'string') throw new Error(p);
    const d = decodeCashAddress(z);
    if (typeof d === 'string') throw new Error(d);
    return encodeCashAddress({ prefix: 'bitcoincash', type: d.type === 'p2shWithTokens' ? 'p2sh' : 'p2pkh', payload: d.payload }).address;
  };

  it('lists EVM addresses in lower case and token-aware addresses by the script of their plain form', () => {
    const locks = testLocksOf([EVM_MAKER, EVM_USER, BCH_MAKER, BCH_USER], 'bitcoincash');
    expect(locks.size).toBe(4);
    expect(locks.has(EVM_MAKER.toLowerCase())).toBe(true);
    expect(locks.has(EVM_USER.toLowerCase())).toBe(true);
    for (const z of [BCH_MAKER, BCH_USER]) {
      expect(plainForm(z)).toMatch(/^bitcoincash:[pq]/);
      expect(ownKey(plainForm(z), 'bitcoincash')).toBe(ownKey(z, 'bitcoincash'));
      expect(locks.has(ownKey(plainForm(z), 'bitcoincash')!)).toBe(true);
    }
    expect(ownKey('0x1234', 'bitcoincash')).toBeNull();
    expect(ownKey(`0x${'g'.repeat(40)}`, 'bitcoincash')).toBeNull();
  });

  it('moves rows whose address is a listed EVM or BCH address, in any case or form', () => {
    const db = new Db(':memory:');
    const row = (kind: 'out' | 'in', address: string) =>
      db.createCrossing({ kind, status: 'sent', asset: 'PUSD', amount: '1', address, origin: 'public' });
    const outMaker = row('out', EVM_MAKER.toUpperCase().replace('0X', '0x'));
    const outUser = row('out', EVM_USER.toLowerCase());
    const inUser = row('in', plainForm(BCH_USER));
    const inMaker = row('in', BCH_MAKER);
    const stranger = row('out', '0x1a877169bB03400fA69EC4813889E78994D194Cb');
    const locks = testLocksOf([EVM_MAKER, EVM_USER, BCH_MAKER, BCH_USER], 'bitcoincash');
    expect(markOwnRows(db, locks, 'bitcoincash')).toBe(4);
    for (const id of [outMaker, outUser, inUser, inMaker]) expect(db.getCrossing(id)!.origin).toBe('test');
    expect(db.getCrossing(stranger)!.origin).toBe('public');
    db.close();
  });
});
