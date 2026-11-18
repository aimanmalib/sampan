import { describe, expect, it } from 'vitest';
import { bech32 } from '@scure/base';
import { encodeNpub, parsePubkeyInput } from './nip19.js';

const HEX = 'e8bcf3823669444d0b49ad45d65088635d9fd8500a75b5f20b59abefa56a144f';
const NPUB = 'npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7';

const tlv = (type: number, value: Uint8Array): number[] => [type, value.length, ...value];
const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
const nprofile = (entries: number[]): string => bech32.encode('nprofile', bech32.toWords(Uint8Array.from(entries)), 5000);

describe('nip19', () => {
  it('round-trips the vector npub', () => {
    expect(encodeNpub(HEX)).toBe(NPUB);
    expect(parsePubkeyInput(NPUB)).toBe(HEX);
    expect(parsePubkeyInput(` nostr:${NPUB.toUpperCase()} `)).toBe(HEX);
  });

  it('accepts a 64-char hex key', () => {
    expect(parsePubkeyInput(HEX.toUpperCase())).toBe(HEX);
  });

  it('reads the key from an nprofile and ignores its relay hints', () => {
    const relay = new TextEncoder().encode('wss://relay.example.com');
    expect(parsePubkeyInput(nprofile([...tlv(1, relay), ...tlv(0, hexBytes(HEX)), ...tlv(1, relay)]))).toBe(HEX);
  });

  it('refuses other prefixes, bad checksums and short keys', () => {
    const nsec = bech32.encode('nsec', bech32.toWords(hexBytes(HEX)));
    expect(parsePubkeyInput(nsec)).toBeNull();
    expect(parsePubkeyInput(`${NPUB.slice(0, -1)}q`)).toBeNull();
    expect(parsePubkeyInput(bech32.encode('npub', bech32.toWords(hexBytes(HEX).subarray(1))))).toBeNull();
    expect(parsePubkeyInput(nprofile(tlv(0, hexBytes(HEX).subarray(1))))).toBeNull();
    expect(parsePubkeyInput('bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6')).toBeNull();
    expect(parsePubkeyInput('')).toBeNull();
  });
});
