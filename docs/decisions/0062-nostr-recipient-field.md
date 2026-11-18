# 0062: A Nostr identity in the Bring in owner field

Date: 2026-11-18. Status: accepted.

## Context

ADR 0060 and 0061 give the page a checked address for a Nostr identity. The first place that uses it is the owner
field of a landing address (Bring in): whoever the payer names there receives the token. The field already opens the
address and its QR code by itself once a valid owner address is pasted (`ui.qrAutoOpen`).

## Decision

- While `features.nostrSend` is on, the field takes an npub, an nprofile, a 64-hex key or (with `nostrId.nip05`) a
  `name@domain`, besides a token address. `web/src/nostr/query.ts` decides which: text that starts like a key, is
  64 hex or holds an `@` (NIP-05 on) is an identity; anything else stays with the address check.
- A full key is looked up as soon as it is typed. A name, or a half-typed key, is looked up once the visitor leaves
  the field, presses Enter or pastes, so a domain is not asked on every key press.
- `web/src/nostr/useNostrRecipient.ts` gives each lookup its own request object. When the text changes, the old
  answer is dropped at once (the card shows "Checking") and a late answer for an earlier request is ignored.
- Only a verified identity can own the landing: the owner sent to `/api/land/open` is the result's `tokenAddress`
  (the same hash as the address the identity proved). A failure shows its reason and nothing else; no address from a
  failed event is shown, copied or offered, and the button stays off.
- The verified card shows the npub shortened to `nostrId.npubShortChars` at each end, the full token address and a
  link to `/how#nostr`. For an identity the address does not open by itself: the visitor sees the card and presses
  the button. Where the card pushes the button below the screen (a phone), the button is scrolled to the middle,
  which keeps the card in view above it.
- `/how#nostr` (only while the flag is on) lists the checks, the relays from config, that no identity server is
  asked, and that a relay can still hide a newer event.

## Consequences

- With the flag off nothing changes: same label, no Nostr text in the page, no relay socket (e2e/nostr.spec.ts).
- e2e answers the relays itself with `page.routeWebSocket` (`e2e/nostr-relays.ts`) on a fake server with the flag on
  (`NOSTR_PORT_OFFSET`); no real relay is reached in tests.
- Undo: `features.nostrSend` false.
