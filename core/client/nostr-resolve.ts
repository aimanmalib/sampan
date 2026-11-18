// What the page calls with whatever the payer typed: an npub, an nprofile, a hex key or (when config allows) a NIP-05
// name. Finds the identity's binding events on the configured relays, keeps the newest valid one across all of them
// (NIP-01: later created_at, then smaller id) and checks it with core/nostr-id. Only an address that passes every step
// comes back; anything else is a reason code (lang key nostr.reason.<code>), never an address.
import type { NostrIdConfig } from '../nostr-config.js';
import { isNewer, type NostrEvent } from '../nostr-id/event.js';
import { parsePubkeyInput } from '../nostr-id/nip19.js';
import { verifyBinding, type NostrReason } from '../nostr-id/verify.js';
import { lookupNip05, parseNip05, type FetchLike } from './nip05.js';
import { queryRelays, type SocketFactory } from './nostr-relays.js';

export type ResolveResult =
  | {
      ok: true;
      /** P2PKH address (q...) for BCH. */
      address: string;
      /** Token-aware address (z...) with the same hash, for PUSD. */
      tokenAddress: string;
      npub: string;
      eventId: string;
      createdAt: number;
      relaysAnswered: number;
    }
  | { ok: false; code: NostrReason; relaysAnswered?: number };

export interface ResolveDeps {
  socket?: SocketFactory;
  fetch?: FetchLike;
}

type ResolveConfig = Pick<
  NostrIdConfig,
  'relays' | 'minRelaysAnswered' | 'queryTimeoutMs' | 'bindingKind' | 'platform' | 'network' | 'nip05' | 'nip05TimeoutMs'
>;

/** The hex key the input stands for, or the reason it stands for none. */
async function keyOf(input: string, config: ResolveConfig, deps: ResolveDeps): Promise<{ pubkey: string } | { code: NostrReason }> {
  const pubkey = parsePubkeyInput(input);
  if (pubkey) return { pubkey };
  const name = config.nip05 ? parseNip05(input) : null;
  if (!name) return { code: 'input_invalid' };
  const found = await lookupNip05(name, { timeoutMs: config.nip05TimeoutMs, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  return found ? { pubkey: found } : { code: 'nip05_failed' };
}

const newestOf = (events: readonly NostrEvent[]): NostrEvent | undefined =>
  events.reduce<NostrEvent | undefined>((best, e) => (!best || isNewer(e, best) ? e : best), undefined);

export async function resolveNostrIdentity(input: string, config: ResolveConfig, deps: ResolveDeps = {}): Promise<ResolveResult> {
  const key = await keyOf(input, config, deps);
  if ('code' in key) return { ok: false, code: key.code };

  const answer = await queryRelays({
    relays: config.relays,
    pubkey: key.pubkey,
    kind: config.bindingKind,
    timeoutMs: config.queryTimeoutMs,
    ...(deps.socket ? { socket: deps.socket } : {}),
  });
  const { relaysAnswered } = answer;
  if (relaysAnswered < config.minRelaysAnswered) return { ok: false, code: 'relays_unreachable', relaysAnswered };

  const newest = newestOf(answer.events);
  if (!newest) return { ok: false, code: 'not_found', relaysAnswered };
  const result = verifyBinding(newest, {
    kind: config.bindingKind,
    platform: config.platform,
    network: config.network,
    others: answer.events,
  });
  if (!result.ok) return { ok: false, code: result.code, relaysAnswered };
  return {
    ok: true,
    address: result.address,
    tokenAddress: result.tokenAddress,
    npub: result.npub,
    eventId: result.eventId,
    createdAt: result.createdAt,
    relaysAnswered,
  };
}
