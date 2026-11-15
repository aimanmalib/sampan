import { binToHex } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { LANDING_RATE_DEN, type LandingParams } from '../core/landing.js';
import { cardFromFragment, cardToFragment, makeCard, readCard } from '../core/landing-card.js';
import { verifyCard } from '../scripts/verify-landing.js';
import { otherLock, PUSD, userLock } from './helpers/pools.js';
import { tokenAddressOf } from '../core/address.js';

const PARAMS: LandingParams = { ownerLockHex: binToHex(userLock), category: PUSD, rateNum: 48_000n, rateDen: LANDING_RATE_DEN, returnAfter: 6 };
const card = () => makeCard(PARAMS, { network: 'mainnet', token: 'PUSD', created: new Date('2026-11-15T00:00:00Z') });

describe('recovery card', () => {
  it('round-trips through JSON with integers as strings', () => {
    const c = JSON.parse(JSON.stringify(card()));
    expect(c.rateNum).toBe('48000');
    expect(c.address).toMatch(/^bitcoincash:p/);
    expect(c.ownerAddress).toMatch(/^bitcoincash:z/);
    const read = readCard(c);
    expect(typeof read).not.toBe('string');
    expect(read).toMatchObject({ params: PARAMS });
  });

  it('rejects a card whose address does not follow from its parameters', () => {
    expect(readCard({ ...card(), rateNum: '47999' })).toMatch(/address does not match/);
  });

  it('rejects a card whose owner address and lock disagree', () => {
    expect(readCard({ ...card(), ownerAddress: tokenAddressOf(binToHex(otherLock), 'bitcoincash') })).toMatch(/ownerAddress/);
  });

  it('rejects other shapes', () => {
    expect(readCard(null)).toMatch(/not a JSON object/);
    expect(readCard({ ...card(), kind: 'other' })).toMatch(/not a sampan-landing card/);
    expect(readCard({ ...card(), rateNum: 48000 })).toMatch(/rateNum must be a string/);
    expect(readCard({ ...card(), ownerLockHex: binToHex(userLock).slice(6) })).toMatch(/owner lock/);
  });
});

describe('verify-landing', () => {
  it('confirms a card from the contract source alone', () => {
    const v = verifyCard(JSON.parse(JSON.stringify(card())));
    expect(v.lines.join('\n')).toMatch(/source compiles to the committed artifact/);
    expect(v.ok).toBe(true);
  });

  it('refuses a tampered card', () => {
    expect(verifyCard({ ...card(), returnAfter: 7 }).ok).toBe(false);
  });

  it('rides in a URL fragment without characters that need escaping, and a damaged or edited one is refused', () => {
    const frag = cardToFragment(card());
    expect(frag).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cardFromFragment(frag)).toMatchObject({ params: PARAMS });
    expect(cardFromFragment(frag.slice(0, -6))).toBeTypeOf('string');
    expect(cardFromFragment('%%%')).toBeTypeOf('string');
    const edited = cardToFragment({ ...card(), rateNum: '1' });
    expect(cardFromFragment(edited)).toMatch(/address does not match/);
  });
});
