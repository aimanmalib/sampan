# 0073: The bounty requirements table is quoted, and its counts are made from the measured runs

Date: 2026-11-19. Status: accepted.

## Context

A reader checking Sampan against the Stablecoin Bridge bounty had to read the bounty page and the README side by side,
and a headline such as "N crossings on N chains" typed by hand goes stale with every new run.

## Decision

- `docs/bounty/stablecoin-bridge.json` holds each requirement, stretch goal and the note on ParyonUSD from
  <https://bchblaze.cash/bounties/>, copied word for word (read with a plain GET on 2026-11-19 14:24 UTC), and every
  word of the table in English and Malay: intro, headline template, column names, status names, one note per row and
  proof labels. The quotes stay in English in both languages.
- `scripts/bounty-table.ts` (`npm run bounty -- --write`) writes the block between `<!-- bounty:start … -->` and
  `<!-- bounty:end -->` in `README.md`, `README.ms.md` and `docs/JUDGE.md`. It counts the ok crossings of the Runs table in
  `docs/MEASURED.md` with the flows of the crossings table (ADR 0065): crossings, chains, other-chain symbols, chains
  with an ok crossing in both directions, and BCH stablecoins (config `tokens`).
- A row with a `rule` gets its status from those counts (both directions, Bring in, Send out from a BCH stablecoin,
  two or more chains, two or more BCH stablecoins, a THORChain crossing, a PUSD crossing). A row without one keeps the
  status written in the file; a requirement not done is `open`.
- A `runs` proof links the BCH leg of the newest ok crossing that matches it; the script stops when there is none.
  File proofs are made relative to the file that holds the block.
- `tests/bounty-table.test.ts` fails when any of the three blocks differs from the script's output. Every row that
  adds a crossing to the Runs table regenerates the block in the same commit.

## Undo

Delete the three blocks, the JSON file and the script; nothing else reads them.
