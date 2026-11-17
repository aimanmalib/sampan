# 0040: The "Choose a route" card in Send out and Bring in

Date: 2026-11-17

## Context

ADR 0039 gives one row per route for the same amount. The page needs to show those rows where the user already asks
for a crossing, without changing the first screen, and without a request to the atomic swap service or its client
while the route is switched off.

## Decision

- The card lives inside the Send out and Bring in panels, just above the action button. It is rendered only when the
  comparison has two rows, so with `features.atom` false, an empty `atom.flows`, a failed check or an unanswered
  quote the panels look and behave exactly as before.
- The page asks the service nothing unless `features.atom` is true and `atom.flows` lists the flow that serves the
  request (PUSD out to USDC on Base, or USDC on Base in as PUSD). Then it loads the client, checks
  `{apiPath}/health` (ADR 0038), and asks `{apiPath}/quote` after the amount has stopped changing for
  `atom.quotePauseMs`. The last answer stays on screen while a new amount is quoted; the comparison marks it stale
  (unavailable) until the new one arrives, rather than showing a number for another amount.
- The rows are native radio inputs in a fieldset: arrow keys move between them, THORChain is checked by default, and
  an unavailable atom row is disabled and states its reason in words (an unknown code is shown as the code). Nothing
  picks the atom route for the user and nothing labels it the better choice.
- Each row shows what it delivers (two decimals, cut, as the panels already show route amounts), the network fees
  as the route reports them (gas units on Base, satoshis on Bitcoin Cash, or THORChain's fee in the received asset),
  the measured median with its count (or "not measured yet") and, behind "How it works", the trust model built from
  the quote's own fields (lock timeout in hours, minutes or Bitcoin Cash blocks, confirmations).
- Choosing the atom row swaps the action button for the atom route's own action. Running an atom swap is the next
  step; until then that button is disabled. The atom row can only appear once `atom.flows` is non-empty, which the
  gate allows only after a measured mainnet swap through this page, so a disabled button is never reachable on the
  live site.
- Text is in every lang file (`compare.*`, `route.atom`, `atom.go`).

## Consequences

- `e2e/atom.spec.ts` covers both engines against the cross-chain fake server, the real minified client and the
  service answered from the fixtures of ADR 0039: both rows, keyboard choice, a refused quote, another AtomLock
  (no quote request at all) and the flag off (no request for the client or the service), plus 320 px width.
- The service answers a refused quote with HTTP 422, which browsers log as a console error line. That is the
  service's documented contract; the spec allows that one line only in the refused-quote case.
- The chain key in config is upper case (`BASE`) while the service names chains in lower case; the comparison now
  matches the chain without regard to case (regression test in `tests/route-compare.test.ts`).
