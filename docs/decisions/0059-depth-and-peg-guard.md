# 0059: Pool depth and a PUSD peg guard

Date: 2026-11-18. Status: accepted.

## Context

Every flow that ends in PUSD trades against the Cauldron pools at the pools' own price. If PUSD drifts away from one
dollar in those pools, a user sending out or bringing in gets less than the cost card suggests, and a landing address
would convert at that price without anyone looking. Nothing on the site showed how deep the pools are or where PUSD
stands against the dollar.

## Decision

- `GET /api/depth` (`server/depth.ts`) reads the pools from the existing `PoolDirectory`, so only pools whose lock
  rebuilds from the owner hash and holds that outpoint on chain count. It answers the number of pools, the BCH and
  PUSD they hold, the mid price (all PUSD over all BCH), the BCH one trade can move before its price is 1% worse than
  mid (fees aside: for a constant product pool a trade of x against reserve X gets X/(X+x) of mid, so x = X/99 over
  the pools taken together), the BCH dollar price, the peg gap and the time of the reading. A reading is reused for
  `cauldron.cacheSeconds`.
- The dollar price comes only from THORChain's `BCH.BCH` pool (`asset_tor_price`), the price source the route
  already uses for gas. No other price source is added. PUSD counts as one dollar, so the gap is
  `(THORChain BCH price / pool mid price - 1)` in basis points (negative: PUSD under one dollar).
- `config.peg.warnBps` (100) and `config.peg.refuseBps` (200), validated (1 to 9999, warn below refuse) and published
  in `/api/config`. At warnBps or more the Swap, Send out, Bring in and landing panels show a warning with the gap.
  At refuseBps or more the server refuses `/api/out/build`, `/api/in/plan` (the Bring in step that plans the
  deposit; there is no `/api/in/build`) and `/api/land/open` with `peg_off` (503). Swaps on Bitcoin Cash stay open
  with the warning: they move between two assets on the same chain at a price the user sees before signing.
- Failure is never shown as a number. The indexer or the BCH servers down: `/api/depth` answers 503 with a message
  and `/how` says the pools could not be read. THORNode down: the pool numbers stay, the peg is "unknown", and
  nothing is refused (the route's own quote decides, as for the health line).
- `/how` has a "Liquidity and peg right now" block with the reading time in UTC and links to the two sources it read:
  the first configured indexer's pool list for the token and THORNode's `BCH.BCH` pool, both from config.
- The fake THORNode capture `pool-gas.json` gains a `BCH.BCH` row priced at the fake pools' own mid price, so the
  fake network reads a peg of about zero.

## Consequences

- Pay invoices are landing addresses created by `POST /api/pay/invoice`; they are not behind the guard in this change.
- Rolling back: set `peg.refuseBps` to 9999 (and `warnBps` just below it) to switch the guard and the warning off
  without a code change; the block on `/how` stays as a reading.
