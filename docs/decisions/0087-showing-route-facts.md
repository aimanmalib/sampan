# 0087: Showing the route facts on the card, on /how and in the READMEs

Date: 2026-11-21

## Context

ADR 0086 measures what each live route takes into `docs/route-facts.json`. A visitor should see it for the route they
are about to use, and a reader of the repository should see the same numbers, in the same words.

## Decision

- **One set of words.** `core/route-facts-text.ts` turns a route fact into text through lang keys `facts.*`. The card
  line, the /how table and the README block all call it, so none of them can drift from the others.
- **Card line.** One line under the primary button of the chosen route (Swap, landing, Send out or Bring in per chain
  and route): about the median time, the signatures, the fee at USD 20, then a link labelled with the number of runs
  and the quote time, to `/how#route-facts`. The fee at USD 20 is the middle of the three quoted amounts. A route with
  no fact draws no line; a route with no time or no quote leaves that part out.
- **Build time, not request time.** The page reads the file through the virtual module `virtual:sampan-route-facts`,
  like `virtual:sampan-proof` reads `docs/MEASURED.md`. The numbers change only when the file is measured again and the
  page is rebuilt, so the line never shows a number nobody measured.
- **/how table.** Every route with time (median, runs, range), signatures and the three fees. Six columns do not fit a
  phone, so each row is a small grid with the column name above each value.
- **READMEs.** `npm run route-facts -- --write` writes the block between `<!-- route-facts:start … -->` and
  `<!-- route-facts:end -->` in `README.md` (English) and `README.ms.md` (Malay). `tests/route-facts-render.test.ts`
  fails when a README block differs from what the generator makes now.
- Slow routes are shown as measured. Minutes start at two minutes; under that the time is in seconds.

## Rollback

Remove `<RouteFactLine>` from the panels and `<RouteFactsTable>` from /how; the measurement file stays.
