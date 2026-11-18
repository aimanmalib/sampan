# 0061: Find a Nostr identity's binding on the configured relays, from the browser

Date: 2026-11-18. Status: accepted.

## Context

ADR 0060 added the verifier for one binding event. The page still has to find that event: turn what the payer typed
(an npub, an nprofile, a 64-hex key or a NIP-05 name) into a key, ask relays for the key's kind 10011 events, choose
one and check it. The point of the feature is that no identity server sits in between, so neither Sampan's server
nor any other service may do the lookup for the page.

## Decision

- `core/client/nostr-relays.ts` opens one WebSocket per relay in `config.nostrId.relays`, all at once, sends
  `["REQ", <id>, {"kinds": [10011], "authors": [<hex>]}]` and waits for `EOSE` or `nostrId.queryTimeoutMs`, then
  sends `CLOSE` and closes. Only a relay that reached `EOSE` counts as answered; `CLOSED`, an error or the timeout
  does not. Every event is checked again on arrival (shape, author, kind, id, signature); anything else is dropped.
- `core/client/nostr-resolve.ts` keeps the newest valid event across all relays (NIP-01: later `created_at`, then
  the smaller id) and passes it to `verifyBinding` with every other valid event as `others`. Fewer answers than
  `nostrId.minRelaysAnswered` is `relays_unreachable`; no event, or a newest event without a `bch` claim (the owner
  withdrew it), is `not_found`. Only a binding that passes every step gives an address; every failure is a reason
  code with no address (lang keys `nostr.reason.<code>`, four languages).
- `core/client/nip05.ts` reads `name@domain` (lower case; a bare IP or a single-label host is refused) and fetches
  `https://<domain>/.well-known/nostr.json?name=<name>` with `credentials: 'omit'`, `redirect: 'error'`, no referrer
  and `nostrId.nip05TimeoutMs`. The answer must name the key as 64 lower-case hex. The domain only maps a name to a
  key; the binding is still checked by its signatures.
- Relay hints in an nprofile and the `relays` field of a NIP-05 answer are ignored. The page asks the configured
  relays only, which keeps the CSP list exact.
- Config: `features.nostrSend` (false) and the `nostrId` block (relays `wss://nos.lol`, `wss://relay.primal.net`,
  `wss://relay.damus.io`; `minRelaysAnswered` 1; both timeouts 4000 ms; kind 10011; platform `bch`; network
  `bitcoincash`; `nip05` true; `npubShortChars` 6). `/api/config` carries `nostrId` only while the flag is on.
- CSP `connect-src` adds the relays' origins only while the flag is on, and the scheme source `https:` only while the
  flag and `nip05` are both on. A NIP-05 domain is the payer's choice and cannot be listed ahead; that is the reason
  for the wider rule. Setting `nip05` to false removes it and leaves npub, nprofile and hex keys working.

## Consequences

- A relay can hide a newer event (for example a withdrawal) by not returning it. Sampan asks every configured relay
  and takes the newest across them; the remaining risk is stated on `/how` when the feature is shown.
- With the flag off nothing changes for visitors: no relay is reachable under the CSP and the page receives no relay
  list. Undo: `features.nostrSend` false (the shipped value).
