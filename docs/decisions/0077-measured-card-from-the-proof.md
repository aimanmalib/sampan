# 0077: The front page "Measured" card counts docs/MEASURED.md, not this server's records

Date: 2026-11-20. Status: accepted.

## Context

The "Measured" card on the front page read `/api/stats`: landings and crossings this server has recorded. Most of
the mainnet crossings were made with the measuring tools and are written in `docs/MEASURED.md` with a transaction id
per leg, so the card undercounted what has been shown on mainnet, and its numbers differed from the README bounty
table, which counts that file.

## Decision

- `config.measured.source` picks the card: `proof` (shipped) or `stats` (the earlier card, the way back).
- With `proof` the headline is counted when the page is built (`virtual:sampan-proof` exports `headline`, made by
  `scripts/measured-json.ts` `measuredHeadline`) with `countStats` of `scripts/bounty-table.ts`, the counter of the
  README bounty table, so the two cannot differ: ok crossings, chains, the far-chain symbols, the chains with an ok
  crossing in each direction ("both ways", left out while there is none) and the distinct transaction ids of those
  crossings (every leg: BCH, the far chain, the conversion).
- The text is a template per language (`measured.headline`, `measured.bothWays`, `measured.txids`); lists are joined
  with the browser's `Intl.ListFormat` in the page's language.
- A link "See every transaction" opens `/how#proof`. This server's records stay as a small second line, shown only
  once the server has completed something, so the card never shows a 0 under the proof.
- `tests/measured-headline.test.ts` checks the built headline against the counter on the real file and against a
  count written separately; a fixture with one more ok crossing counts one more.

## Consequences

The card changes only when MEASURED.md changes and the page is rebuilt. Setting `source` to `stats` and deploying
brings back the earlier card.
