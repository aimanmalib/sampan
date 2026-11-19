# 0076: "My activity" lists a connected wallet's crossings and finds where a transaction id leads

Date: 2026-11-19. Status: accepted.

## Context

A visitor who closed the tab after a crossing has no way back to its status page: the link lived only in that tab.
Some come back with a transaction id from their wallet or an explorer, others with the same wallet connected.

## Decision

- A page at `/activity`, linked from the footer (not from the first screen). Nothing is built, signed or sent there.
- "Find a transaction": the page accepts only a full id (64 hex digits, with or without `0x`; `core/activity.ts`
  `bareTxid`) and asks `GET /api/lookup/<txid>`. The server looks in its own records first: the crossing's txid, the
  payment or finishing transaction of a landing address, or the payout txid kept in a receipt. Found: `200 {url}` with
  the crossing's status page `/c/<id>`, which the page opens. Otherwise THORChain's public `/thorchain/tx/status`
  through the same THORNode client and node list the route uses: seen: `200 {url}` with `thorchain.explorerTxUrl`, which
  the page shows as a link. Neither: `404 not_found`. Not a full id: `400 bad_txid`. THORNode not answering: `503`.
- "Your crossings": the page sends `POST /api/activity` with the addresses of the wallets connected on it (every
  address the BCH wallet scan derived, plain and token form, and the connected EVM address). The server returns the
  crossings stored for those addresses, newest first: kind, status, asset and chain, amount, time and the status page
  link, never the addresses. It has no way to list anything else. Crossings out are stored with the EVM address they
  paid; swaps, landings and crossings in with the BCH address, so the page says which wallet finds which.
- Matching: EVM addresses in lower case, CashAddr without its prefix (`addressKey`), on both sides.
- The word a row shows comes from its kind and stored status (`activityState`, `ACTIVITY_STATES` in
  `core/activity.ts`), as the server writes them: a swap is done once broadcast; a landing is in progress until its
  watcher converts or returns the coins; a crossing out or in is "sent, open it for the status" once its deposit goes
  out, because the server stores the route's final answer (completed, refunded, failed) only when its status page asks
  the route. The list never calls a crossing out or in done before that. Quotes built or planned but never signed
  (`UNSIGNED`) are not crossings and are left out of the list by the server.
- Limits in config `activity`: `maxAddresses` per request and `maxRows` returned, validated in `core/config.ts`.
  Both endpoints share the quote rate limit (`rate.quotesPerMinute`).
- Text in `lang/*.json` (`activity.*`, `footer.activity`) for every language in `config.i18n`.

## Consequences

- Anyone can ask about any address, as on a block explorer; the answer holds only what the status page of each crossing
  already shows to whoever has its link.
- A crossing out made with a BCH wallet and paid to an EVM address the visitor does not connect is found by its txid,
  not by the list.

## Undo

Remove the footer link and the `/activity` branch in `web/src/App.tsx`; the two endpoints answer nothing the status
pages do not.
