// When a recipient field's text is a Nostr identity, and when to look it up. Pure (tests/nostr-query.test.ts).
// A full npub, nprofile or hex key is looked up as soon as it is typed; anything else that looks like an identity
// (a name@domain, a half-typed npub) only once the visitor has finished with the field, so a domain is not asked on
// every key press and a half-typed key gets its reason only when the visitor is done.
import type { NostrIdConfig } from '../../../core/nostr-config.js';
import { parsePubkeyInput } from '../../../core/nostr-id/nip19.js';

const KEY_START = /^(nostr:)?(npub1|nprofile1)/i;
const HEX_KEY = /^[0-9a-f]{64}$/i;

/** True when the text is meant as a Nostr identity rather than a Bitcoin Cash address. */
export function looksLikeNostr(text: string, nostrId: Pick<NostrIdConfig, 'nip05'>): boolean {
  const value = text.trim();
  if (KEY_START.test(value) || HEX_KEY.test(value)) return true;
  return nostrId.nip05 && value.includes('@');
}

/** The text to look up now, or null to wait. `committed` is what the field held when the visitor last finished with it. */
export function nostrQuery(text: string, committed: string): string | null {
  const value = text.trim();
  if (value === '') return null;
  if (parsePubkeyInput(value)) return value;
  return committed.trim() === value ? value : null;
}

/** npub1 + the first and last `chars` characters of the rest. */
export function shortNpub(npub: string, chars: number): string {
  const rest = npub.startsWith('npub1') ? npub.slice(5) : npub;
  if (rest.length <= chars * 2 + 1) return npub;
  return `npub1${rest.slice(0, chars)}…${rest.slice(-chars)}`;
}
