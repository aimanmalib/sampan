# 0064: A halted chain is marked paused, not hidden

Date: 2026-11-18. Status: accepted. Amends ADR 0041 (a chain the route reports halted is not offered) and ADR 0063
(how THORChain's row reads while it halts a network).

## Context

THORChain halts chains one at a time (Ethereum, Base and Bitcoin were each halted on 2026-11-18 at different hours).
The network list used to drop a halted chain, and a tab with no chain left was replaced by "Paused by the route" with
one sentence and no list. A visitor who came for USDC on Ethereum saw it vanish without a reason, and a fully paused tab
did not say which chains were affected or when the page looks again.

## Decision

- One pure function, `core/cross-choices.ts` `networkStatus()`, lists for a direction every asset live on a route that
  is switched on (THORChain; 1Click while `features.oneClick` is on), each with `open`, `routesOpen` and `pausedBy`.
  THORChain carries a row while its last health check saw Bitcoin Cash and that chain open, or while the check is
  unknown. 1Click has no per-chain halt report, so a row it lists live counts as open (ADR 0063). Rows keep config
  order whatever their state, so the list does not jump when a chain halts or reopens. `crossChoices()` is now the
  open rows of the same function. No chain names are written in code; everything comes from config and `/api/health`.
- Network picker: a paused row stays visible with its radio disabled and a pill "Paused by {route}" (route name from
  the language files). The chosen network falls back to the first open one while it is paused, and comes back when the
  next health answer sees it open; the page asks `/api/health` again on its existing interval and when the tab becomes
  visible.
- "Choose a route": while THORChain halts the chosen network, its row is unavailable with the reason "{route} has
  paused this network for now." and the 1Click row is the one the button runs.
- "Paused by the route" replaces a crossing form only when none of its networks is open (Bitcoin Cash halted on every
  route, or every chain halted with no other route carrying it). It now lists each network with its state and says how
  often the page checks again (`ops.healthRetrySeconds`). With no network listed at all, the route's own report decides,
  as before.
- New text keys in all four languages: `cross.network.paused`, `compare.reason.chainPaused`, `paused.route.recheck`.

## Consequences

- One halted chain no longer pauses a tab or hides that chain; the other chains stay quotable.
- Server behaviour does not change: THORChain requests for a halted chain still answer 503 `chain_halted`.
- `e2e/network-pause.spec.ts` checks both engines with Ethereum and Base halted and BNB Smart Chain open, every chain
  halted, and a chain reopening without a reload. `e2e/network.spec.ts` now expects Base listed as paused.
- Undo: revert this change; the old list (halted chains dropped) comes back with the previous `openChoices()`.
