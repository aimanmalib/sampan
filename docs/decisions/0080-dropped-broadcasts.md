# 0080: A run is ok when the network knows its transaction, not when the page says done

Date: 2026-11-20

## Context

During the demo recording a swap on the live site and a Bring in conversion on the recording server were broadcast,
accepted by an Electrum server, shown as done by the page, and then dropped. No configured server knows either
transaction. The pool coin they built on went to a third-party trade in the next block. Cauldron pools are public,
so any trade can spend the pool coin a Sampan transaction also spends, and the network keeps one of the two.

The recording tool wrote both as `ok` rows in `docs/MEASURED.md`, because it trusted the page.

What each flow does when this happens:

- Swap: the wallet's coins are spent by nothing once the swap is dropped, so they are back in the wallet. Nothing
  is lost; the swap did not happen. The page cannot know this at broadcast time.
- Landing address: the arrived BCH is unspent at the landing address again. The landing stays `watching`, so the
  finisher builds a new conversion on its next round (the subscription, the poll, or "Check again") and the
  crossing takes the new transaction id. `server/landing/watcher.test.ts` covers it. On mainnet the recording
  server was started again with the same database and converted the stranded coin in its first round.

## Decision

- Measuring and recording tools (`tools/measure/land.ts`, `tools/video/record.ts`) pass each run through
  `checkRun` in `tools/measure/seen.ts`. Every BCH transaction id of the row must be known (mempool or block) to at
  least two servers of `electrum.servers`, asked a few times while a fresh broadcast spreads. Otherwise the row is
  written as `fail (broadcast dropped: …)` and the shot is marked `ok: false`.
- Rows already written for dropped transactions stay in `docs/MEASURED.md` as failures with the reason. They are
  not deleted.
- The server and the pages do not change in this decision: a swap that loses the pool coin returns nothing to
  recover, and the landing finisher already makes the conversion again.

## Consequences

- A paid run takes a few seconds longer to record.
- Being known to two servers is not a confirmation. A transaction can still lose a race after that, so the README
  tables are made again whenever a row changes, and a reviewer can check each id against a block explorer.
- Way back: `--seen-min 0` on `tools/video/record.ts` turns the check off for a run.
