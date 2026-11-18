// Asks Nostr relays, straight from the browser, for one author's binding events (NIP-01 REQ / EOSE / CLOSE).
// Relays are not trusted: every event is checked again here (shape, author, kind, id, signature) and anything else is
// dropped. All relays are asked at once; a relay counts as answered only when it says it has sent everything (EOSE).
import { isValidEventOf } from '../nostr-id/verify.js';
import type { NostrEvent } from '../nostr-id/event.js';

/** The part of a browser WebSocket this module uses (tests pass a fake). */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface RelayQuery {
  relays: readonly string[];
  /** Author, 64 hex characters. */
  pubkey: string;
  kind: number;
  timeoutMs: number;
  /** Defaults to the browser's WebSocket. */
  socket?: SocketFactory;
  /** Subscription id; tests pass a fixed one. */
  subscriptionId?: string;
}

export interface RelayAnswer {
  /** Relays that sent EOSE before the timeout. */
  relaysAnswered: number;
  /** Valid events of the author and kind from every relay, each id once. */
  events: NostrEvent[];
}

const browserSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

const randomId = (): string => {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** One relay: resolves with its valid events and whether it reached EOSE in time. Never rejects. */
function askRelay(url: string, query: Required<Omit<RelayQuery, 'relays'>>): Promise<{ answered: boolean; events: NostrEvent[] }> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    let settled = false;
    let socket: SocketLike | undefined;
    const finish = (answered: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (answered) socket?.send(JSON.stringify(['CLOSE', query.subscriptionId]));
        socket?.close();
      } catch {
        // A socket that is already closing has nothing left to tell.
      }
      resolve({ answered, events });
    };
    const timer = setTimeout(() => finish(false), query.timeoutMs);
    try {
      socket = query.socket(url);
    } catch {
      finish(false);
      return;
    }
    socket.onopen = () => {
      try {
        socket?.send(JSON.stringify(['REQ', query.subscriptionId, { kinds: [query.kind], authors: [query.pubkey] }]));
      } catch {
        finish(false);
      }
    };
    socket.onmessage = (ev) => {
      let message: unknown;
      try {
        message = typeof ev.data === 'string' ? JSON.parse(ev.data) : null;
      } catch {
        return;
      }
      if (!Array.isArray(message) || message[1] !== query.subscriptionId) return;
      if (message[0] === 'EVENT' && isValidEventOf(message[2], query.pubkey, query.kind)) events.push(message[2]);
      else if (message[0] === 'EOSE') finish(true);
      else if (message[0] === 'CLOSED') finish(false);
    };
    socket.onerror = () => finish(false);
    socket.onclose = () => finish(false);
  });
}

/** Asks every relay at once and merges what came back. */
export async function queryRelays(query: RelayQuery): Promise<RelayAnswer> {
  const full = {
    pubkey: query.pubkey,
    kind: query.kind,
    timeoutMs: query.timeoutMs,
    socket: query.socket ?? browserSocket,
    subscriptionId: query.subscriptionId ?? randomId(),
  };
  const answers = await Promise.all(query.relays.map((url) => askRelay(url, full)));
  const byId = new Map<string, NostrEvent>();
  for (const answer of answers) for (const event of answer.events) byId.set(event.id, event);
  return { relaysAnswered: answers.filter((a) => a.answered).length, events: [...byId.values()] };
}
