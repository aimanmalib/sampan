# 0054: A finished crossing, one per direction, read from the measurements

Date: 2026-11-18. Status: accepted.

## Context

A judge who opens Send out or Bring in has no USDC on Ethereum and does not want to wait several minutes for a
crossing. The crossings are already measured on mainnet and recorded in `docs/MEASURED.md` with both chains'
transaction ids.

## Decision

- `config/sampan.json` `site.finished.out` and `site.finished.in` name one crossing per direction by its BCH
  transaction id ("" = no link). The validator takes only a lower case BCH txid or "".
- `/done/<BCH txid>` shows that Runs row as the page build read it (`virtual:sampan-proof`, the same parser as the
  /how proof table): when it started, the amount, the measured time (first broadcast until arrival is seen on the
  other chain, as `tools/measure/cross.ts` measures it) and every transaction id in full with its explorer link.
  Chain names and explorers come from config, through one helper shared with the /how table.
- The link shows only when `core/proof.ts` `finishedCrossing` finds an ok row of that direction whose BCH id is the
  configured one and which also records the other chain's transaction. A unit test fails when the configured ids are
  not such rows of the real `docs/MEASURED.md`.
- Bring in shows the link under either source while crossings are open, so the judge does not have to pick the other
  chain first. Send out shows it under the form, and under "Paused by the route" too.
- Nothing is fetched by the page: a row changes only with MEASURED.md and a new build, like the /how table.

## Rollback

Set `site.finished.out` / `.in` to "" and rebuild: the links disappear and `/done/…` shows the plain "not in the
measurements" note.
