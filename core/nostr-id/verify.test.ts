// Nostr identity verifier against the Tambat vectors (copied byte for byte, source in tambat-vectors.source.json), a real
// binding read from public relays, and one mutant per reason code.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { base58AddressToLockingBytecode, binToHex, decodeCashAddress, encodeCashAddress, hash160 } from '@bitauth/libauth';
import { recoverSigner, verificationText } from './claim.js';
import { eventId, type NostrEvent } from './event.js';
import { encodeNpub } from './nip19.js';
import { verifyBinding, type VerifyOptions } from './verify.js';
import { addressOfKey, nostrPubkey, signBchMessage, signEvent, testKey } from '../../tests/helpers/nostr-sign.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON fixtures, shape checked by the assertions
const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), 'utf8'));
const vectors = fixture('tambat-vectors.json');
const owner = fixture('nostr-owner-binding.json');
const OPTS: VerifyOptions = { kind: 10011, platform: 'bch', network: 'bitcoincash' };

const vectorEvent = (): NostrEvent => structuredClone(vectors.bindingEvent);
const nostrKey = testKey(vectors.paths.nostr);
const bchKey = testKey(vectors.paths.bch);
const bchTag = (address: string, proof: string): string[] => ['i', `bch:${address}`, proof];
const resign = (tags: string[][], key = nostrKey, overrides: Partial<NostrEvent> = {}): NostrEvent =>
  signEvent({ created_at: vectors.bindingEvent.created_at, kind: 10011, content: '', tags, ...overrides }, key);

describe('Tambat vectors', () => {
  it('rebuilds the npub, the signed text, the BCH key and the address', () => {
    expect(encodeNpub(vectors.nostr.pubkey)).toBe(vectors.nostr.npub);
    const signer = recoverSigner(vectors.bchSignature, verificationText(vectors.nostr.npub));
    expect(signer && binToHex(signer)).toBe(vectors.bch.publicKey);
    const payload = hash160(signer!);
    expect(encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload }).address).toBe(vectors.bch.address.bitcoincash);
    expect(eventId(vectors.bindingEvent)).toBe(vectors.bindingEvent.id);
  });

  it('derives the same keys as the vectors (so the mutants below are signed by the vector keys)', () => {
    expect(nostrPubkey(nostrKey)).toBe(vectors.nostr.pubkey);
    expect(addressOfKey(bchKey)).toBe(vectors.bch.address.bitcoincash);
  });

  it('recovers an uncompressed key from the external signed-message vector (header 27)', () => {
    const signer = recoverSigner(vectors.external.signature, vectors.external.message);
    expect(signer?.length).toBe(65);
    const lock = base58AddressToLockingBytecode(vectors.external.legacyAddress);
    if (typeof lock === 'string') throw new Error(lock);
    expect(binToHex(lock.bytecode)).toBe(`76a914${binToHex(hash160(signer!))}88ac`);
  });

  it('verifies the binding event with every step passing', () => {
    const res = verifyBinding(vectorEvent(), OPTS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.npub).toBe(vectors.nostr.npub);
    expect(res.address).toBe(vectors.bch.address.bitcoincash);
    expect(res.bchPublicKey).toBe(vectors.bch.publicKey);
    expect(res.steps.map((s) => `${s.step}:${s.status}`)).toEqual([
      'event_shape:pass', 'kind:pass', 'event_id:pass', 'nostr_sig:pass', 'newest:skip',
      'bch_sig:pass', 'address_match:pass', 'network:pass', 'key_separation:pass',
    ]);
  });
});

describe('real binding read from relays', () => {
  it('verifies, with the token address carrying the same hash as the P2PKH address', () => {
    const res = verifyBinding(owner.event, { ...OPTS, others: [owner.event] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.npub).toBe(owner.npub);
    expect(res.address).toBe(owner.address);
    expect(res.tokenAddress.startsWith('bitcoincash:z')).toBe(true);
    const q = decodeCashAddress(res.address);
    const z = decodeCashAddress(res.tokenAddress);
    if (typeof q === 'string' || typeof z === 'string') throw new Error('decode');
    expect(z.type).toBe('p2pkhWithTokens');
    expect(binToHex(z.payload)).toBe(binToHex(q.payload));
  });
});

describe('mutants fail with a named reason', () => {
  const code = (ev: unknown, opts: VerifyOptions = OPTS): string => {
    const res = verifyBinding(ev, opts);
    return res.ok ? 'ok' : res.code;
  };
  const vectorTag = vectors.bindingEvent.tags[1] as string[];

  it('content changed -> id_mismatch', () => {
    expect(code({ ...vectorEvent(), content: 'x' })).toBe('id_mismatch');
  });

  it('signature changed -> nostr_sig_invalid', () => {
    const ev = vectorEvent();
    ev.sig = `${ev.sig.slice(0, -2)}${ev.sig.endsWith('00') ? '01' : '00'}`;
    expect(code(ev)).toBe('nostr_sig_invalid');
  });

  it('claim made for another npub -> wrong_signer', () => {
    expect(code(resign([vectorTag], testKey("m/44'/1237'/0'/0/1")))).toBe('wrong_signer');
  });

  it('bchtest: address with the same key -> wrong_network', () => {
    expect(code(resign([bchTag(vectors.bch.address.bchtest, vectors.bchSignature)]))).toBe('wrong_network');
  });

  it('P2SH address with the same hash -> address_invalid', () => {
    expect(code(resign([bchTag(addressOfKey(bchKey, 'bitcoincash', 'p2sh'), vectors.bchSignature)]))).toBe('address_invalid');
  });

  it('the Nostr key also signs as the BCH key -> same_key', () => {
    const proof = signBchMessage(verificationText(vectors.nostr.npub), nostrKey);
    expect(code(resign([bchTag(addressOfKey(nostrKey), proof)]))).toBe('same_key');
  });

  it('a newer event without the claim -> replaced for the old one, not_found for the newer one', () => {
    const newer = resign([['i', 'github:example', 'abc123']], nostrKey, { created_at: vectors.bindingEvent.created_at + 60 });
    expect(code(vectorEvent(), { ...OPTS, others: [newer, vectorEvent()] })).toBe('replaced');
    expect(code(newer, { ...OPTS, others: [newer, vectorEvent()] })).toBe('not_found');
  });

  it('a newer event with a bad signature from a relay is ignored', () => {
    const forged = { ...resign([], nostrKey, { created_at: vectors.bindingEvent.created_at + 60 }) };
    forged.sig = vectorEvent().sig;
    expect(code(vectorEvent(), { ...OPTS, others: [forged] })).toBe('ok');
  });

  it('two valid bch claims -> ambiguous', () => {
    const second = testKey("m/44'/145'/0'/0/1");
    const proof = signBchMessage(verificationText(vectors.nostr.npub), second);
    expect(code(resign([vectorTag, bchTag(addressOfKey(second), proof)]))).toBe('ambiguous');
  });

  it('another kind -> wrong_kind', () => {
    expect(code(resign([vectorTag], nostrKey, { kind: 0 }))).toBe('wrong_kind');
  });

  it('a proof that is not a signature -> bch_sig_invalid; not an event -> input_invalid', () => {
    expect(code(resign([bchTag(vectors.bch.address.bitcoincash, 'AAAA')]))).toBe('bch_sig_invalid');
    expect(code({ ...vectorEvent(), created_at: '1' })).toBe('input_invalid');
    expect(code(null)).toBe('input_invalid');
  });
});
