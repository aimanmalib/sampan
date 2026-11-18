// Test-only signers for Nostr events and BCH signed messages, from the public BIP39 test phrase of the Tambat vectors.
// Never use these keys for funds.
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { binToBase64, binToHex, encodeCashAddress, hash160, hexToBin } from '@bitauth/libauth';
import { deriveBchKey } from '../../core/keys.js';
import { signedMessageHash } from '../../core/nostr-id/claim.js';
import { eventId, type NostrEvent } from '../../core/nostr-id/event.js';

export const TEST_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** Private key at a BIP44 path of the test phrase. */
export const testKey = (path: string): Uint8Array => deriveBchKey(TEST_PHRASE, 'mainnet', path).privateKey;

export const nostrPubkey = (privateKey: Uint8Array): string => binToHex(schnorr.getPublicKey(privateKey));

/** A complete event signed by the key; the pubkey comes from the key. */
export function signEvent(fields: Pick<NostrEvent, 'created_at' | 'kind' | 'tags' | 'content'>, privateKey: Uint8Array): NostrEvent {
  const unsigned = { ...fields, pubkey: nostrPubkey(privateKey) };
  const id = eventId(unsigned);
  return { ...unsigned, id, sig: binToHex(schnorr.sign(hexToBin(id), privateKey)) };
}

/** Base64 BCH signed message with a compressed-key header (31 + recovery id). */
export function signBchMessage(text: string, privateKey: Uint8Array): string {
  const sig = secp256k1.sign(signedMessageHash(text), privateKey);
  const out = new Uint8Array(65);
  out[0] = 31 + sig.recovery;
  out.set(sig.toCompactRawBytes(), 1);
  return binToBase64(out);
}

/** P2PKH (or another type) cashaddr of the compressed public key of a private key. */
export function addressOfKey(privateKey: Uint8Array, prefix: 'bitcoincash' | 'bchtest' = 'bitcoincash', type: 'p2pkh' | 'p2sh' = 'p2pkh'): string {
  return encodeCashAddress({ prefix, type, payload: hash160(secp256k1.getPublicKey(privateKey, true)) }).address;
}
