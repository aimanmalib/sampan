// When a recipient field's text counts as a Nostr identity, and when the page looks it up (web/src/nostr/query.ts).
import { describe, expect, it } from 'vitest';
import vectors from './fixtures/tambat-vectors.json' with { type: 'json' };
import { looksLikeNostr, nostrQuery, shortNpub } from '../web/src/nostr/query.js';

const NPUB = vectors.nostr.npub;

describe('looksLikeNostr', () => {
  it('takes npub, nprofile, nostr: links and hex keys, half typed or not', () => {
    for (const text of [NPUB, 'npub1abc', `nostr:${NPUB}`, 'nprofile1qq', vectors.nostr.pubkey, ` ${NPUB} `]) {
      expect(looksLikeNostr(text, { nip05: false }), text).toBe(true);
    }
  });
  it('leaves Bitcoin Cash addresses to the address check', () => {
    for (const text of [vectors.bch.address.bitcoincash, 'bitcoincash:zq', 'qqyx49mu0k', '']) {
      expect(looksLikeNostr(text, { nip05: true }), text).toBe(false);
    }
  });
  it('takes name@domain only while NIP-05 is on', () => {
    expect(looksLikeNostr('alice@example.com', { nip05: true })).toBe(true);
    expect(looksLikeNostr('alice@example.com', { nip05: false })).toBe(false);
  });
});

describe('nostrQuery', () => {
  it('looks up a full key at once', () => {
    expect(nostrQuery(NPUB, '')).toBe(NPUB);
    expect(nostrQuery(vectors.nostr.pubkey, '')).toBe(vectors.nostr.pubkey);
  });
  it('waits for a name or a half-typed key until the field is left', () => {
    expect(nostrQuery('alice@example.com', '')).toBeNull();
    expect(nostrQuery('alice@example.com', 'alice@example.co')).toBeNull();
    expect(nostrQuery('alice@example.com', 'alice@example.com')).toBe('alice@example.com');
    expect(nostrQuery('npub1abc', '')).toBeNull();
    expect(nostrQuery('npub1abc', 'npub1abc')).toBe('npub1abc');
  });
  it('asks nothing for an empty field', () => {
    expect(nostrQuery('  ', '  ')).toBeNull();
  });
});

describe('shortNpub', () => {
  it('keeps npub1 and the given characters at each end', () => {
    expect(shortNpub(NPUB, 6)).toBe(`npub1${NPUB.slice(5, 11)}…${NPUB.slice(-6)}`);
  });
  it('leaves a short value alone', () => {
    expect(shortNpub('npub1abcdef', 6)).toBe('npub1abcdef');
  });
});
