// The nostrId block of config/sampan.json: how the page finds and checks a Nostr identity's Bitcoin Cash address
// (core/client/nostr-resolve.ts). Pure. The page talks to the listed relays and, for a name@domain, to that domain's
// own /.well-known/nostr.json; no identity server is involved. features.nostrSend switches the feature on.

export interface NostrIdConfig {
  /** Relays the page asks, all at once (wss URLs). Relay hints inside an nprofile or a NIP-05 answer are ignored. */
  relays: string[];
  /** Fewer relays than this answering the query = relays_unreachable. */
  minRelaysAnswered: number;
  /** How long one relay may take to send all its events (EOSE). */
  queryTimeoutMs: number;
  /** Event kind of the binding (NIP-39 external identities). */
  bindingKind: number;
  /** NIP-39 platform name of the Bitcoin Cash claim. */
  platform: string;
  /** Cashaddr prefix a claim must use to be paid. */
  network: string;
  /** Accept name@domain (NIP-05). Off = only npub, nprofile or hex keys, and no https: in connect-src. */
  nip05: boolean;
  /** How long the domain's nostr.json may take. */
  nip05TimeoutMs: number;
  /** Characters kept at each end of a shortened npub after "npub1". */
  npubShortChars: number;
}

const WSS = /^wss:\/\/[a-z0-9.-]+(?::\d+)?(\/\S*)?$/;
const timeoutOk = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 500 && (v as number) <= 15000;

/** Returns a list of problems; an empty list means the block can be used. */
export function validateNostrId(n: NostrIdConfig | undefined): string[] {
  if (!n || typeof n !== 'object') return ['nostrId: object'];
  const errors: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) errors.push(message);
  };
  const relays = Array.isArray(n.relays) ? n.relays : [];
  need(relays.length > 0 && relays.every((r) => typeof r === 'string' && WSS.test(r)), 'nostrId.relays: a list of wss:// URLs');
  need(new Set(relays).size === relays.length, 'nostrId.relays: each relay at most once');
  need(
    Number.isInteger(n.minRelaysAnswered) && n.minRelaysAnswered >= 1 && n.minRelaysAnswered <= relays.length,
    'nostrId.minRelaysAnswered: integer from 1 to the number of relays',
  );
  need(timeoutOk(n.queryTimeoutMs), 'nostrId.queryTimeoutMs: integer from 500 to 15000');
  need(timeoutOk(n.nip05TimeoutMs), 'nostrId.nip05TimeoutMs: integer from 500 to 15000');
  need(n.bindingKind === 10011, 'nostrId.bindingKind: 10011');
  need(n.platform === 'bch', 'nostrId.platform: bch');
  need(n.network === 'bitcoincash', 'nostrId.network: bitcoincash');
  need(typeof n.nip05 === 'boolean', 'nostrId.nip05: true or false');
  need(Number.isInteger(n.npubShortChars) && n.npubShortChars >= 4 && n.npubShortChars <= 20, 'nostrId.npubShortChars: integer from 4 to 20');
  return errors;
}

/**
 * Sources to add to connect-src: nothing while the feature is off; the relays while it is on; and https: while it is
 * on with NIP-05, because a name's domain is the user's own and cannot be listed ahead (switch nip05 off to drop it).
 */
export function nostrConnectSources(enabled: boolean, n: NostrIdConfig): string[] {
  if (!enabled) return [];
  return [...n.relays.map((r) => new URL(r).origin), ...(n.nip05 ? ['https:'] : [])];
}

/** The page's copy of the block: null while the feature is off, so the page knows no relay then. */
export const nostrIdPublic = (enabled: boolean, n: NostrIdConfig): NostrIdConfig | null => (enabled ? n : null);
