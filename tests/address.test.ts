import { describe, expect, it } from 'vitest';
import { shortAddress } from '../web/src/address.js';

describe('shortAddress', () => {
  it('drops the prefix and keeps both ends', () => {
    expect(shortAddress('bitcoincash:zabcdefghijklmnopqrstuvwxyz0123')).toBe('zabcde…z0123');
  });
  it('leaves short values whole', () => {
    expect(shortAddress('bchtest:zabc')).toBe('zabc');
    expect(shortAddress('zabcdefghijk')).toBe('zabcdefghijk');
  });
});
