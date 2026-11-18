// Finding a Nostr identity's BCH address from the page: relays asked through a fake WebSocket, NIP-05 through a fake
// fetch. Relays and domains are untrusted: forged, old or foreign events are dropped and only a verified address comes back.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bech32 } from '@scure/base';
import { decodeCashAddress } from '@bitauth/libauth';
import type { NostrIdConfig } from '../core/nostr-config.js';
import type { NostrEvent } from '../core/nostr-id/event.js';
import { encodeNpub } from '../core/nostr-id/nip19.js';
import { lookupNip05, parseNip05, type FetchLike } from '../core/client/nip05.js';
import { queryRelays, type SocketFactory, type SocketLike } from '../core/client/nostr-relays.js';
import { resolveNostrIdentity } from '../core/client/nostr-resolve.js';
import { signEvent, testKey } from './helpers/nostr-sign.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON fixtures, shape checked by the assertions
const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const vectors = fixture('tambat-vectors.json');
const owner = fixture('nostr-owner-binding.json');

const RELAYS = ['wss://relay-a.test', 'wss://relay-b.test', 'wss://relay-c.test'];
const CONFIG: NostrIdConfig = {
  relays: RELAYS,
  minRelaysAnswered: 1,
  queryTimeoutMs: 80,
  bindingKind: 10011,
  platform: 'bch',
  network: 'bitcoincash',
  nip05: true,
  nip05TimeoutMs: 80,
  npubShortChars: 6,
};

/** What one fake relay does after REQ: send these events, then EOSE (default), CLOSED, nothing (times out) or fail. */
interface Script {
  events?: unknown[];
  end?: 'eose' | 'closed' | 'silent' | 'error';
}

function fakeRelays(scripts: Record<string, Script>) {
  const opened: string[] = [];
  const sent: Record<string, unknown[]> = {};
  const closed = new Set<string>();
  const socket: SocketFactory = (url) => {
    opened.push(url);
    sent[url] = [];
    const script = scripts[url] ?? {};
    const s: SocketLike = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send(data) {
        const message = JSON.parse(data) as unknown[];
        sent[url]!.push(message);
        if (message[0] !== 'REQ') return;
        const sub = message[1];
        queueMicrotask(() => {
          for (const ev of script.events ?? []) s.onmessage?.({ data: JSON.stringify(['EVENT', sub, ev]) });
          s.onmessage?.({ data: JSON.stringify(['EVENT', 'another-subscription', script.events?.[0]]) });
          s.onmessage?.({ data: 'not json' });
          const end = script.end ?? 'eose';
          if (end === 'eose') s.onmessage?.({ data: JSON.stringify(['EOSE', sub]) });
          if (end === 'closed') s.onmessage?.({ data: JSON.stringify(['CLOSED', sub, 'blocked']) });
        });
      },
      close() {
        closed.add(url);
      },
    };
    queueMicrotask(() => (script.end === 'error' ? s.onerror?.({}) : s.onopen?.({})));
    return s;
  };
  return { socket, opened, sent, closed };
}

const nostrKey = testKey(vectors.paths.nostr);
const binding = (): NostrEvent => structuredClone(vectors.bindingEvent);
const npub: string = vectors.nostr.npub;
const later = (seconds: number, tags: string[][] = binding().tags): NostrEvent =>
  signEvent({ created_at: binding().created_at + seconds, kind: 10011, content: '', tags }, nostrKey);

describe('queryRelays', () => {
  it('asks every relay for the author and kind, closes the subscription and keeps each valid event once', async () => {
    const relays = fakeRelays({ [RELAYS[0]!]: { events: [binding()] }, [RELAYS[1]!]: { events: [binding()] }, [RELAYS[2]!]: {} });
    const answer = await queryRelays({ relays: RELAYS, pubkey: vectors.nostr.pubkey, kind: 10011, timeoutMs: 80, socket: relays.socket, subscriptionId: 's1' });
    expect(answer.relaysAnswered).toBe(3);
    expect(answer.events.map((e) => e.id)).toEqual([vectors.bindingEvent.id]);
    expect(relays.sent[RELAYS[0]!]).toEqual([
      ['REQ', 's1', { kinds: [10011], authors: [vectors.nostr.pubkey] }],
      ['CLOSE', 's1'],
    ]);
    expect([...relays.closed].sort()).toEqual([...RELAYS].sort());
  });

  it('drops forged events, other authors and other kinds', async () => {
    const forged = { ...binding(), content: 'changed' };
    const badSig = { ...binding(), sig: binding().sig.replace(/^./, (c: string) => (c === '0' ? '1' : '0')) };
    const otherAuthor = signEvent({ created_at: 1, kind: 10011, content: '', tags: [] }, testKey("m/44'/1237'/0'/0/1"));
    const otherKind = signEvent({ created_at: 1, kind: 1, content: '', tags: [] }, nostrKey);
    const relays = fakeRelays({ [RELAYS[0]!]: { events: [forged, badSig, otherAuthor, otherKind, 'junk', null] } });
    const answer = await queryRelays({ relays: [RELAYS[0]!], pubkey: vectors.nostr.pubkey, kind: 10011, timeoutMs: 80, socket: relays.socket });
    expect(answer).toEqual({ relaysAnswered: 1, events: [] });
  });

  it('counts a relay that times out, refuses (CLOSED) or fails as not answered, and closes it', async () => {
    const relays = fakeRelays({ [RELAYS[0]!]: { events: [binding()], end: 'silent' }, [RELAYS[1]!]: { end: 'closed' }, [RELAYS[2]!]: { end: 'error' } });
    const answer = await queryRelays({ relays: RELAYS, pubkey: vectors.nostr.pubkey, kind: 10011, timeoutMs: 40, socket: relays.socket });
    expect(answer.relaysAnswered).toBe(0);
    expect(answer.events).toHaveLength(1);
    expect([...relays.closed].sort()).toEqual([...RELAYS].sort());
  });

  it('answers when the socket cannot even be created', async () => {
    const answer = await queryRelays({
      relays: RELAYS,
      pubkey: vectors.nostr.pubkey,
      kind: 10011,
      timeoutMs: 40,
      socket: () => {
        throw new Error('blocked by CSP');
      },
    });
    expect(answer).toEqual({ relaysAnswered: 0, events: [] });
  });
});

describe('NIP-05', () => {
  const okFetch = (names: unknown, ok = true) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return { ok, json: async () => ({ names, relays: { [vectors.nostr.pubkey]: ['wss://hint.example'] } }) };
    };
    return { fetch, calls };
  };

  it('reads name@domain in lower case and nothing else', () => {
    expect(parseNip05(' Alice@Example.COM ')).toEqual({ name: 'alice', domain: 'example.com' });
    for (const bad of ['alice', '@example.com', 'alice@', 'alice@localhost', 'alice@127.0.0.1', 'a b@example.com', 'alice@exa mple.com']) {
      expect(parseNip05(bad), bad).toBeNull();
    }
  });

  it('asks only the domain itself, without cookies or redirects, and returns the hex key', async () => {
    const { fetch, calls } = okFetch({ alice: vectors.nostr.pubkey });
    await expect(lookupNip05({ name: 'alice', domain: 'example.com' }, { timeoutMs: 80, fetch })).resolves.toBe(vectors.nostr.pubkey);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://example.com/.well-known/nostr.json?name=alice');
    expect(calls[0]!.init).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails on a missing name, a broken key, an error status, a redirect or a timeout', async () => {
    const cases: FetchLike[] = [
      okFetch({ bob: vectors.nostr.pubkey }).fetch,
      okFetch({ alice: vectors.nostr.pubkey.slice(1) }).fetch,
      okFetch({ alice: vectors.nostr.pubkey.toUpperCase() }).fetch,
      okFetch(null).fetch,
      okFetch({ alice: vectors.nostr.pubkey }, false).fetch,
      async () => {
        throw new TypeError('redirect mode is set to error');
      },
      (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('timeout')))),
    ];
    for (const fetch of cases) {
      await expect(lookupNip05({ name: 'alice', domain: 'example.com' }, { timeoutMs: 30, fetch })).resolves.toBeNull();
    }
  });
});

describe('resolveNostrIdentity', () => {
  const run = (input: string, scripts: Record<string, Script>, config: Partial<NostrIdConfig> = {}, fetch?: FetchLike) => {
    const relays = fakeRelays(scripts);
    const result = resolveNostrIdentity(input, { ...CONFIG, ...config }, { socket: relays.socket, ...(fetch ? { fetch } : {}) });
    return { result, relays };
  };

  it("returns the owner's verified address and its token address for a real binding read from public relays", async () => {
    const { result } = run(owner.npub, { [RELAYS[0]!]: { events: [owner.event] }, [RELAYS[1]!]: {}, [RELAYS[2]!]: { end: 'silent' } });
    const r = await result;
    expect(r).toMatchObject({ ok: true, address: owner.address, npub: owner.npub, eventId: owner.event.id, relaysAnswered: 2 });
    if (!r.ok) throw new Error('not ok');
    const q = decodeCashAddress(r.address);
    const z = decodeCashAddress(r.tokenAddress);
    if (typeof q === 'string' || typeof z === 'string') throw new Error('bad address');
    expect(z.type).toBe('p2pkhWithTokens');
    expect(z.payload).toEqual(q.payload);
  });

  it('takes the newest valid event across relays, ignoring a forged newer one', async () => {
    const newer = later(60);
    const forgedNewest = { ...later(120, []), sig: binding().sig };
    const { result } = run(npub, { [RELAYS[0]!]: { events: [binding(), forgedNewest] }, [RELAYS[1]!]: { events: [newer] } });
    await expect(result).resolves.toMatchObject({ ok: true, eventId: newer.id, address: vectors.bch.address.bitcoincash });
  });

  it('says not_found when the newest event has no bch claim (withdrawn) or no event exists', async () => {
    const withdrawn = later(60, []);
    await expect(run(npub, { [RELAYS[0]!]: { events: [binding()] }, [RELAYS[1]!]: { events: [withdrawn] } }).result).resolves.toEqual({
      ok: false,
      code: 'not_found',
      relaysAnswered: 3,
    });
    await expect(run(npub, { [RELAYS[0]!]: {} }).result).resolves.toMatchObject({ ok: false, code: 'not_found' });
  });

  it('says relays_unreachable when fewer relays answer than config asks', async () => {
    const silent = Object.fromEntries(RELAYS.map((r) => [r, { events: [binding()], end: 'silent' as const }]));
    await expect(run(npub, silent).result).resolves.toEqual({ ok: false, code: 'relays_unreachable', relaysAnswered: 0 });
    const one = { ...silent, [RELAYS[0]!]: { events: [binding()] } };
    await expect(run(npub, one, { minRelaysAnswered: 2 }).result).resolves.toMatchObject({ code: 'relays_unreachable', relaysAnswered: 1 });
  });

  it('passes a failing binding on as its reason code, with no address', async () => {
    const bad = later(10, [['i', `bch:${vectors.bch.address.bchtest}`, vectors.bchSignature]]);
    const r = await run(npub, { [RELAYS[0]!]: { events: [bad] } }).result;
    expect(r).toEqual({ ok: false, code: 'wrong_network', relaysAnswered: 3 });
  });

  it('asks only the configured relays for an nprofile, whatever relays it hints', async () => {
    const hex = Uint8Array.from(Buffer.from(vectors.nostr.pubkey, 'hex'));
    const hint = new TextEncoder().encode('wss://hint.example');
    const nprofile = bech32.encode('nprofile', bech32.toWords(Uint8Array.from([1, hint.length, ...hint, 0, 32, ...hex])), 5000);
    const { result, relays } = run(nprofile, { [RELAYS[0]!]: { events: [binding()] } });
    await expect(result).resolves.toMatchObject({ ok: true, npub });
    expect(relays.opened.sort()).toEqual([...RELAYS].sort());
  });

  it('looks a NIP-05 name up on its domain, then checks the key it names on the relays', async () => {
    const fetch: FetchLike = async () => ({ ok: true, json: async () => ({ names: { alice: vectors.nostr.pubkey } }) });
    await expect(run('alice@example.com', { [RELAYS[0]!]: { events: [binding()] } }, {}, fetch).result).resolves.toMatchObject({
      ok: true,
      npub: encodeNpub(vectors.nostr.pubkey),
    });
  });

  it('says nip05_failed when the domain does not name a key, and asks no relay', async () => {
    const fetch: FetchLike = async () => ({ ok: true, json: async () => ({ names: {} }) });
    const { result, relays } = run('alice@example.com', {}, {}, fetch);
    await expect(result).resolves.toEqual({ ok: false, code: 'nip05_failed' });
    expect(relays.opened).toEqual([]);
  });

  it('says input_invalid for anything else, and for a name while config has NIP-05 off, without asking anyone', async () => {
    let fetched = 0;
    const fetch: FetchLike = async () => {
      fetched += 1;
      return { ok: true, json: async () => ({}) };
    };
    for (const [input, nip05] of [['hello', true], ['npub1xyz', true], ['alice@example.com', false]] as const) {
      const { result, relays } = run(input, {}, { nip05 }, fetch);
      await expect(result).resolves.toEqual({ ok: false, code: 'input_invalid' });
      expect(relays.opened).toEqual([]);
    }
    expect(fetched).toBe(0);
  });
});
