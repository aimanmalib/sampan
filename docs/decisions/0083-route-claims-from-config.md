# 0083: Crossing claims made from config

Date: 2026-11-20

## Context

Sentences about crossings were written once and then outlived the config. The hero line named only `route.active`
("carried by THORChain") while 1Click also carries Ethereum and Base. `/how` said every listed stablecoin goes "to PUSD
as one flow" on every listed chain, though some assets were live in one direction only. A chain chip said "open" when
only one direction was open.

## Decision

- `core/route-claims.ts` (pure) turns the public config into one claim per chain: the symbols a crossing sends out to
  it, the symbols it brings in from it, and the routes carrying them (THORChain first, then NEAR Intents while
  `features.oneClick` is on). It reads the same rows the network lists use (`networkStatus`), so the text, the chips
  and the pickers cannot disagree. No chain, asset or route name is written in code.
- `/how` "What Sampan adds" has one Bring in line and one Send out line, each listing the symbols and chains of that
  direction (`how.adds.in`, `how.adds.out`, `how.adds.item`); a direction with nothing live has no line. The crossing
  diagram shows a node for every route that carries a claim.
- Hero chips: `hero.chip.open` only when both directions are open, `hero.chip.outOnly` or `hero.chip.inOnly` for one
  direction, `hero.chip.paused` when listed but halted (from `GET /api/health`).
- The hero line names every live route, joined with the page's word for "or" (`text.or`).
- AVAX.USDC Bring in is marked live: the Runs table holds an ok `in` row for it (2026-11-20 12:16 UTC). AVAX.USDT
  Bring in stays off until measured.
- README limits and the deck slide say the routes and chains are those marked live in config, instead of naming one.

## Consequences

Turning an asset's `live` flag on or off changes every sentence and chip that mentions it, in all four languages,
with no code change. Undo: revert the commit; the old keys are gone from `lang/`, so the revert restores them too.
