# 0063: 1Click does not wait on THORChain's halt report

Date: 2026-11-18. Status: accepted. Amends ADR 0048 ("the second route only offers assets that the THORChain route also
offers") and ADR 0050 (the 1Click row is shown next to a THORChain quote).

## Context

On 2026-11-18 THORChain had Ethereum and Base halted in `inbound_addresses` at different times. Every cross-chain tab then
showed "Paused by the route", although the 1Click route (ADR 0048) has its own deposit addresses and does not depend on
THORChain's vaults. The page built its network list from THORChain's live assets and THORChain's open map only, and the
server paused every new crossing while THORChain's health check saw the route closed, whichever route the request named.

## Decision

- Network list: a pure function `core/cross-choices.ts` `crossChoices()` joins THORChain's offered choices (live, chain
  open in its last health check, unchanged) with 1Click's assets live in that direction while `features.oneClick` is on.
  1Click publishes no per-chain halt report; its configured chains count as open, as `server/routes/oneclick.ts` `open()`
  already treats them. One choice per chain and symbol; a choice carries `thor: false` when only 1Click offers it.
- The page sends THORChain no quote request for a `thor: false` network. Its row in "Choose a route" gets the code
  `chain_halted`; how that row is worded and which row is preselected is decided with the per-chain pause work (KSG6).
- "Paused by the route" replaces a crossing tab only when THORChain reports its route halted and 1Click offers nothing
  in that direction.
- Server: `crossingGate` checks THORChain's health only for THORChain requests. A request with `route: near-intents`
  does not wait on it; THORChain requests keep answering 503 `route_paused` / `chain_halted` as before.
- Config: `oneClick.assets` lists USDC on Base (`nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near`,
  6 decimals, read in ADR 0048) with `live` false. BNB Smart Chain and TRON stay out of the 1Click list.

## Consequences

- With THORChain halted on a chain, a 1Click asset marked live for that chain stays offered. Nothing changes on the live
  site while `features.oneClick` is false and no 1Click asset is live (each asset goes live only after two measured runs).
- Tests: `tests/cross-choices.test.ts`, `tests/oneclick-api.test.ts` (THORChain halted, 1Click answers; turning the
  THORChain check back on for 1Click requests makes it fail), `e2e/oneclick-halt.spec.ts` (both engines).
- Undo: `features.oneClick` false, or `live` false on the asset, then deploy.
