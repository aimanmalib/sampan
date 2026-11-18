# 0058: A receipt on every finished crossing out or in

Date: 2026-11-18. Status: accepted.

## Context

The cost card (`core/cost.ts`) says what a crossing should cost before it is signed. After it
lands, the status page `/c/:id` showed a three-step timeline and two shortened transaction ids. A user, or anyone
checking the work, could not see from the page what was actually paid and received, or follow the THORChain leg.

## Decision

- The THORChain route's `status()` also returns the inbound id and the single coin of the inbound and of the
  payout, as `/thorchain/tx/status/<hash>` records them (8 decimals for every asset). Anything else (several coins,
  a malformed amount) is left out rather than guessed.
- `core/receipt.ts` (pure, bigint) turns that into a receipt: each leg (BCH, THOR, the EVM chain) with its full id,
  what went in and what came out, the cost (paid minus received, in USD) and the share kept (received / paid). The
  stablecoins count as USD 1; BCH is valued at the price of the quote the crossing was built from (what the route
  pays or charges, fees included), the same rule as the cost card. No outside price is used. A coin that is not what
  this kind of crossing moves (out: BCH in, a configured stablecoin out; in: the reverse; a refund: the asset paid)
  is neither shown nor valued.
- The time is from the moment the transaction was prepared until the server saw the payout, and the page says so.
  The server only asks the route while someone has the page open, so this can be longer than the crossing itself.
- Once a crossing is final, paid out and both amounts are known, the receipt is stored on the row
  (`crossings.receipt_json`, added in place). The raw quote is still cleared after `ops.quotePayloadHours`; the
  receipt, a transaction record, keeps its price. A stored receipt also means the page stops asking the route.
- Explorer hosts come only from config: `connect.explorerTxUrl` (Bitcoin Cash), the new
  `thorchain.explorerTxUrl`, published to the page as `routeExplorerTxUrl` (the rest of the `thorchain` section stays
  on the server), and `evm.chains[].explorer`. `https://thorchain.net/tx/{txid}` was opened in a browser on
  2026-11-18 with the measured inbound `c803bfef…76fd0` and showed that swap (0.014 BCH for USDC); two other
  explorers answered with a bot check and were not used.
- A route that does not report amounts (1Click) gets a receipt with its transactions only.

## Rollback

Set `thorchain.explorerTxUrl` to another explorer with `{txid}`. Removing `<Receipt>` from `CrossingPage.tsx` brings
back the short id lines (`OutStatus` `txLinks`); the stored column is ignored by older code.
