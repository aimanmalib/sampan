# 0095: A wallet that disconnects is shown as disconnected

Status: accepted, 2026-11-21

## Context

The BCH wallet connects through WizardConnect. Its connection manager reports `disconnect` when the wallet ends the
session, and `reconnecting` when the relay drops or the wallet stops answering pings. The page only knew "Waiting for
your wallet": a wallet that had gone left the page in that state with no end, and the stored pairing kept trying.

## Decision

- A new wallet status `lost`. It is entered when the manager reports `disconnect`, or when a wallet that was ready has
  been `reconnecting` for `connect.lostAfterSeconds` (config, default 20). A wallet that answers again before then
  (`walletready`) stays connected. A stored pairing that never reached its wallet is left to the existing retry hint.
- Entering `lost` drops the session and the wallet scan (the header balance goes) and clears the stored pairing.
- A notice under the card says "Wallet disconnected" with one button, "Connect again", which starts a new pairing
  without reloading the page. Text in `lang/<code>.json` (`wallet.lost.*`).
- The rule lives in `web/src/wallet/lost.ts` (`watchLost`), a small listener with no React in it, so it is tested with
  a fake manager and a fake clock (`tests/wallet-lost.test.ts`). Under `SAMPAN_FAKE` the fake wallet gets a stand-in
  source driven by a `sampan:wallet-link` window event, used only by `e2e/wallet-lost.spec.ts`.

## Consequences

- A wallet that drops for less than `connect.lostAfterSeconds` and comes back is not interrupted.
- Rollback: a very large `connect.lostAfterSeconds` keeps the old behaviour for a dropped relay; removing the watcher
  in `useWallet.ts` restores it fully.
