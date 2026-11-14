import { describe, expect, it } from 'vitest';
import { Db } from './db.js';

describe('Db', () => {
  it('creates, updates and reads a crossing with a 128-bit id', () => {
    const db = new Db(':memory:', () => 1000);
    const id = db.createCrossing({ kind: 'swap', status: 'built', asset: 'PUSD', amount: '100000', address: 'bitcoincash:zx', origin: 'public', quote: { a: 1 } });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    db.updateCrossing(id, { status: 'broadcast', txid: 'ab'.repeat(32), attempts: 1 });
    const row = db.getCrossing(id)!;
    expect(row).toMatchObject({ kind: 'swap', status: 'broadcast', txid: 'ab'.repeat(32), attempts: 1, origin: 'public' });
    expect(JSON.parse(row.quote_json!)).toEqual({ a: 1 });
    db.close();
  });

  it('clears raw quote payloads only after the configured hours', () => {
    let now = 0;
    const db = new Db(':memory:', () => now);
    const id = db.createCrossing({ kind: 'swap', status: 'built', asset: 'PUSD', amount: '1', address: 'a', origin: 'test', quote: { q: 1 } });
    now = 23 * 3_600_000;
    expect(db.purgeQuotes(24)).toBe(0);
    now = 25 * 3_600_000;
    expect(db.purgeQuotes(24)).toBe(1);
    expect(db.getCrossing(id)!.quote_json).toBeNull();
    db.close();
  });

  it('rejects an unknown crossing kind', () => {
    const db = new Db(':memory:');
    expect(() => db.createCrossing({ kind: 'teleport' as never, status: 'x', asset: 'a', amount: '1', address: 'a', origin: 'public' })).toThrow();
    db.close();
  });
});
