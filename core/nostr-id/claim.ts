// The NIP-39 `bch` claim: ["i", "bch:<cashaddr>", "<BCH signed message, base64>"] in a kind 10011 event. Pure.
// The address key signs "Verifying that I control the following Nostr public key: <npub>" for the event author.
// Format as written up in the Tambat protocol (https://github.com/aimanmalib/tambat, docs/NIP-39-bch.md).
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  base64ToBin,
  binToHex,
  decodeCashAddress,
  encodeCashAddress,
  hash160,
  isBase64,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';

export const verificationText = (npub: string): string =>
  `Verifying that I control the following Nostr public key: ${npub}`;

export interface BchClaim {
  /** Full cashaddr as written in the tag, after the platform prefix. */
  address: string;
  proof: string;
}

/** Every `i` tag of the given platform (`bch`) that carries an identity and a proof. */
export function bchClaims(tags: string[][], platform: string): BchClaim[] {
  const head = `${platform}:`;
  return tags
    .flatMap(([name, identity, proof]) =>
      name === 'i' && identity?.startsWith(head) && proof !== undefined ? [{ address: identity.slice(head.length), proof }] : [],
    );
}

function compactSize(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
}

/** Double SHA-256 of the Bitcoin signed-message preimage for the text. */
export function signedMessageHash(text: string): Uint8Array {
  const magic = utf8ToBin('\x18Bitcoin Signed Message:\n');
  const body = utf8ToBin(text);
  const size = compactSize(body.length);
  const preimage = new Uint8Array(magic.length + size.length + body.length);
  preimage.set(magic, 0);
  preimage.set(size, magic.length);
  preimage.set(body, magic.length + size.length);
  return sha256.hash(sha256.hash(preimage));
}

/** Public key recovered from a 65-byte base64 proof over the text, in the encoding its header declares; null if invalid. */
export function recoverSigner(proof: string, text: string): Uint8Array | null {
  if (typeof proof !== 'string' || !isBase64(proof)) return null;
  const bytes = base64ToBin(proof);
  if (bytes.length !== 65) return null;
  const header = bytes[0] ?? 0;
  if (header < 27 || header > 34) return null;
  const compressed = header >= 31;
  try {
    const point = secp256k1.Signature.fromCompact(bytes.subarray(1))
      .addRecoveryBit((header - 27) & 3)
      .recoverPublicKey(signedMessageHash(text));
    return point.toRawBytes(compressed);
  } catch {
    return null;
  }
}

/** Cashaddr network prefixes libauth knows. */
export type ClaimPrefix = 'bitcoincash' | 'bchtest' | 'bchreg';

export type ParsedClaimAddress =
  | { ok: true; prefix: ClaimPrefix; hash: Uint8Array }
  | { ok: false };

/** A claim address must be a lowercase P2PKH cashaddr with a 20-byte hash; P2SH and token-aware types are refused. */
export function parseClaimAddress(address: string): ParsedClaimAddress {
  if (address !== address.toLowerCase() || !address.includes(':')) return { ok: false };
  const decoded = decodeCashAddress(address);
  if (typeof decoded === 'string' || decoded.type !== 'p2pkh' || decoded.payload.length !== 20) return { ok: false };
  return { ok: true, prefix: decoded.prefix, hash: decoded.payload };
}

/** The P2PKH address and its token-aware twin (same hash) for a 20-byte hash. */
export function addressesOf(prefix: ClaimPrefix, hash: Uint8Array): { address: string; tokenAddress: string } {
  return {
    address: encodeCashAddress({ prefix, type: 'p2pkh', payload: hash }).address,
    tokenAddress: encodeCashAddress({ prefix, type: 'p2pkhWithTokens', payload: hash }).address,
  };
}

export const hash160Hex = (publicKey: Uint8Array): string => binToHex(hash160(publicKey));
