// NIP-19 decoding for the identities a payer types: npub, nprofile (TLV type 0 only) and a bare 64-char hex key. Pure.
// Relay hints inside an nprofile are ignored on purpose: Sampan only asks the relays in its own config.
import { bech32 } from '@scure/base';

const HEX64 = /^[0-9a-f]{64}$/;
/** Bech32 strings longer than the BIP-173 limit are allowed by NIP-19 (nprofile with relay hints). */
const MAX_NIP19_LENGTH = 5000;

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const isHexPubkey = (value: string): boolean => HEX64.test(value);

/** npub for a 32-byte x-only public key in hex. */
export function encodeNpub(pubkeyHex: string): string {
  if (!isHexPubkey(pubkeyHex)) throw new Error('public key must be 64 lowercase hex characters');
  const bytes = Uint8Array.from(pubkeyHex.match(/../g) ?? [], (h) => parseInt(h, 16));
  return bech32.encode('npub', bech32.toWords(bytes), MAX_NIP19_LENGTH);
}

function decodeBech(value: string): { prefix: string; data: Uint8Array } | null {
  try {
    const decoded = bech32.decode(value as `${string}1${string}`, MAX_NIP19_LENGTH);
    return { prefix: decoded.prefix, data: bech32.fromWords(decoded.words) };
  } catch {
    return null;
  }
}

/** Public key hex from the first TLV entry of type 0 (special) in an nprofile payload. */
function nprofilePubkey(data: Uint8Array): string | null {
  for (let i = 0; i + 2 <= data.length; ) {
    const type = data[i];
    const length = data[i + 1] ?? 0;
    const value = data.subarray(i + 2, i + 2 + length);
    if (value.length !== length) return null;
    if (type === 0) return length === 32 ? toHex(value) : null;
    i += 2 + length;
  }
  return null;
}

/** Hex public key for an npub, nprofile or 64-char hex key (case-insensitive, trimmed); null when it is none of those. */
export function parsePubkeyInput(input: string): string | null {
  const value = input.trim().toLowerCase().replace(/^nostr:/, '');
  if (isHexPubkey(value)) return value;
  const decoded = decodeBech(value);
  if (!decoded) return null;
  if (decoded.prefix === 'npub') return decoded.data.length === 32 ? toHex(decoded.data) : null;
  if (decoded.prefix === 'nprofile') return nprofilePubkey(decoded.data);
  return null;
}
