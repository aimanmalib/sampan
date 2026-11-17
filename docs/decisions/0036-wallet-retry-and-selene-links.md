# 0036 A way out of "Waiting for your wallet", and no Selene deep link

Date: 2026-11-17

## Context

On the owner's phone, Selene once stayed on "Waiting for your wallet" and paired on the second try. Five new pairings
with Selene web against the live site all paired at the first try (docs/MEASURED.md, Wallets checked), so a fresh
pairing is not the problem we could reproduce. What we did reproduce is on our side: the WizardConnect library stores a
pairing in the browser and reconnects to it on the next visit. When the wallet no longer answers that pairing (it was
removed in the wallet, or the wallet app is closed), the page shows a disabled "Waiting for your wallet" with no dialog
and no other control, for as long as the page is open, and again on every reload. A browser that had paired with
Selene web on 2026-11-15 was in that state on 2026-11-17.

The library's own disconnect cannot be the exit: it first sends a message through the relay and waits for it, and a
relay connection that is not ready queues that message without end.

We also looked for a documented way for a website to open Selene directly. Read on 2026-11-17: https://selene.cash/,
https://git.xulu.tech/selene.cash/selene-wallet/ and its README (the wiki did not render). None describes a deep link,
URL scheme or WizardConnect pairing link for websites.

## Decision

- `connect.retryHintSeconds` (config, 20) is how long "Waiting for your wallet" may last before the page adds one line,
  "Still waiting? Your wallet may have closed this connection. Start again with a new link.", with a Start again button
  (`wallet.retryHint`, `wallet.startAgain`). It appears under the card while a stored pairing reconnects, and inside the
  pairing dialog while a new link waits for the wallet.
- Start again deletes the stored pairing and reloads the page. The next Connect wallet makes a new link. This is the one
  exit that does not depend on the relay.
- No "Open in Selene" button: there is no documented link to point it at. Copy link stays the way to pair on the same
  phone.
- The two new strings in Indonesian and Filipino were translated with software, like the rest of those files
  (ADR 0035), and stay under that label.
- `e2e/wallet-retry.spec.ts` stores a pairing for a wallet that does not exist, checks the stuck state, moves the page
  clock past `connect.retryHintSeconds`, and checks that Start again gives back an enabled Connect wallet. It fails on
  the code before this change.

## Rollback

Raise `connect.retryHintSeconds` to hide the line in practice, or revert the change; nothing is stored on the server.
