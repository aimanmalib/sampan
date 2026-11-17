# 0050: 1Click row in "Choose a route"

Date: 2026-11-17. Status: accepted. Follows ADR 0039 (comparison), ADR 0040 (route card) and ADR 0049 (server
module). No deploy; `features.oneClick` stays false and no 1Click asset is live, so the page is unchanged.

## Context

ADR 0049 added 1Click (NEAR Intents) on the server as a second route next to THORChain. The page needs a way to
show it and to run a crossing through it, without changing what THORChain does.

## Decision

- `compareRoutes` returns one row per offered route: THORChain (always, selected by default), the atomic swap route
  (as before) and 1Click, only while `features.oneClick` is true and `oneClick.assets` marks that chain and symbol
  live in that direction. A refused or pending 1Click quote is an unavailable row with its reason; a quote for
  another amount is `stale`. "Receives more" goes to the one available row that receives the most in the same
  asset, and to none on a tie.
- The 1Click row shows the amount and fee as its quote reports them, "Not measured yet" until runs `oc-out`/`oc-in`
  exist, and the quote's own time estimate named as that route's estimate. "How it works" says the deposit address
  is one-time, solvers fill the swap, and an unfilled deposit is refunded to your own address after the quote's
  deadline (`oneClick.deadlineMinutes`). No speed or uptime claim.
- `/api/config` gains `oneClick` with only `assets` (chain, symbol, live), `dryDebounceMs`, `statusPollSeconds`
  and `deadlineMinutes`. No host, user agent, asset id or key. The page asks its own server
  (`/api/out/quote`, `/api/in/quote` with `route: "near-intents"`) after `dryDebounceMs`; it never calls 1Click.
- Picking the row makes the panel read the 1Click quote: the receive line, the cost card, the action and the
  disclosure all name that route. Send out keeps two steps from PUSD. Bring in sends one ERC-20 `transfer`, with
  no approval.
- Checks before signing: 1Click has no memo, so the page checks the quote in the build or plan reply. That quote
  must be for 1Click, pay the address typed here (or the landing address the page recomputed), and promise at
  least the minimum shown. Out: the deposit has two outputs and no OP_RETURN (rule 6). In: the token, the exact
  token units and the expiry. An answer for the other route is refused either way.
- The cost card counts the received token in 1e8 units. 1Click reports the token's own decimals (6 for USDC), so
  the shared mapping scales `expectedOut` and the named fees by `outDecimals`. THORChain is unchanged because its
  quotes use 8.
- 1Click's "Amount is too low…" refusal becomes `below_route_min`. The row says the amount is below that route's
  minimum and gives no number, because config does not hold 1Click's minimum.
- Status after sending opens at `/c/:id`, as for THORChain (the server asks 1Click by deposit address).

## Consequences

- Undo: `features.oneClick` false, or `live` false for an asset, removes the row and every 1Click request from the
  page (e2e `oneclick.spec.ts` checks that no request names the route).
- Next: terms text for the route, then two measured mainnet runs per direction before any `live` flag.
