# 0074: "You keep" compares every network of the chosen stablecoin before signing

Date: 2026-11-19. Status: accepted.

## Context

Send out and Bring in quote one network at a time. The "Choose a route" card compares routes, but it appears only
when a second route is on, so a visitor sees no comparison today, though the same stablecoin often crosses on two or
three chains at different costs.

## Decision

- Behind `features.keepCompare` (shipped off). Once the panel could ask for its own quote (amount filled, and the
  destination address for Send out, the Bitcoin Cash address for Bring in), a "Compare networks" list shows every
  network the chosen stablecoin is listed on for that direction, in config order.
- Each open network is quoted through the same endpoint the panel uses (`/api/out/quote`, `/api/in/quote`; a network
  only 1Click carries is quoted by 1Click) and costed with the same card (`web/src/cost/inputs.ts`, `core/cost.ts`). A
  row reads "You keep {amount} {symbol} ({pct}%)", the card's total cost and its time range. No new formula.
- `core/keep.ts` is pure: the row that keeps the most is marked when at least two open rows are priced and they differ;
  a paused network (core/cross-choices, KSG6) stays listed, greyed with the route that paused it, cannot be pressed and
  never wins; a failed quote is a row without numbers and does not stop the others.
- Pressing a row picks that network, as the Network picker does.
- `keepCompare.maxNetworks` caps the open networks quoted at once (the picked one is always among them); paused rows ask
  for nothing. `keepCompare.debounceMs` is the pause after the last keystroke. Both are validated in `core/config.ts`.
- Bring in leaves gas out of every row alike and says so: gas differs by chain and is known only with a wallet on that
  chain connected.
- With the flag on, the "Choose a route" rows say "You keep" too, with the percent only when both sides count as USD 1.

## Undo

`features.keepCompare` false and deploy: the list and the "You keep" wording disappear, the panels are as before.
