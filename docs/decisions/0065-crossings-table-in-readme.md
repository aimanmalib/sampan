# 0065: The README's crossings table is made from the measured runs

Date: 2026-11-18. Status: accepted.

## Context

`docs/MEASURED.md` lists every mainnet crossing (flows `out` and `in`) with one transaction id per leg, but the README
showed none of them and still said no crossing had been measured. A reader checking a crossing had to copy each id into
an explorer by hand, and a table typed by hand would drift from the file each time a run is added.

## Decision

- `scripts/crossings-table.ts` (`npm run crossings -- --write`) writes the rows between
  `<!-- crossings:start … -->` and `<!-- crossings:end -->` in README.md and README.ms.md. Each README keeps its own
  header row inside the block, so the script holds no text in either language; the rows are names, amounts and links.
- Rows: every `out` and `in` run, failed ones included. `oc-out` / `oc-in` (1Click) rows appear only in a direction
  where at least one `oneClick.assets[]` entry is live, so the README does not mention a route the site does not offer.
- Every leg is a link built from config, as on the receipt page: `bch` and `convert` use `connect.explorerTxUrl`, an EVM
  leg uses `evm.chains[].explorer` + `/tx/`, and the THORChain trace uses `thorchain.explorerTxUrl` with the inbound
  leg (BCH for Send out, the EVM deposit for Bring in). The older swap table above it keeps its hand-written links.
- A leg or chain with no explorer in config stops the script, so a new chain cannot appear unlinked.
- `tests/crossings-table.test.ts` fails when either README differs from the script's output, and checks that each leg
  of each successful crossing is linked in both.
- The Limits section now says the crossing is on only for assets marked `live`, each after two measured crossings.

## Undo

Delete the block and the script; nothing else reads them.
