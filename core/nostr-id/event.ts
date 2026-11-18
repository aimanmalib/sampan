// NIP-01 events: shape, id (SHA-256 of the canonical serialisation) and the BIP-340 signature. Pure.
// A relay is not trusted: every event is checked here, whatever the relay or a cache says about it.
import { schnorr } from '@noble/curves/secp256k1';
import { binToHex, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

const isHex = (value: unknown, length: number): value is string =>
  typeof value === 'string' && value.length === length && /^[0-9a-f]+$/.test(value);

/** True when the value has every NIP-01 field with the right type (ids and keys lowercase hex). */
export function isEventShape(value: unknown): value is NostrEvent {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    isHex(e.id, 64) &&
    isHex(e.pubkey, 64) &&
    isHex(e.sig, 128) &&
    Number.isSafeInteger(e.created_at) &&
    (e.created_at as number) >= 0 &&
    Number.isSafeInteger(e.kind) &&
    (e.kind as number) >= 0 &&
    typeof e.content === 'string' &&
    Array.isArray(e.tags) &&
    e.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))
  );
}

/** NIP-01 id: SHA-256 of the JSON array [0, pubkey, created_at, kind, tags, content]. */
export function eventId(event: Omit<NostrEvent, 'id' | 'sig'>): string {
  const serial = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  return binToHex(sha256.hash(utf8ToBin(serial)));
}

/** BIP-340 Schnorr check of sig over id by pubkey. Never throws. */
export function verifyEventSig(event: NostrEvent): boolean {
  try {
    return schnorr.verify(hexToBin(event.sig), hexToBin(event.id), hexToBin(event.pubkey));
  } catch {
    return false;
  }
}

/** NIP-01 order for replaceable events: larger created_at wins; on a tie the lower id wins. */
export const isNewer = (a: NostrEvent, b: NostrEvent): boolean =>
  a.created_at !== b.created_at ? a.created_at > b.created_at : a.id < b.id;
