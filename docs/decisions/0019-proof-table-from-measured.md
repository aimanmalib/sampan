# 0019 Proof table on /how, built from MEASURED.md

Date: 2026-11-16. Status: accepted.

## Context

`docs/MEASURED.md` is the record of every mainnet run, failures included. A reader of the site should be able to see the
same counts and open the transactions without going to the repository.

## Decision

- `core/proof.ts` parses the Runs table and the Wallets checked table. It is pure and shared by the page build, the unit
  tests and the e2e test, so the page and the tests cannot read the file differently.
- A row counts as `ok` only when its result is `ok` and its txid cell holds a full transaction id (64 hex, or `0x` + 64
  hex on Base, or a crossing cell `bch … · base 0x… [· convert …]`). Failed rows count as failed. An `ok` row without a
  full id is counted apart ("without a transaction id") and never as `ok`. Flows with no rows are left out.
- The page gets the summary at build time through a Vite virtual module (`virtual:sampan-proof`, defined in
  `vite.config.ts` with `scripts/measured-json.ts`), so `npm run build` reads the file and no generated JSON is
  committed or fetched at run time. `npx tsx scripts/measured-json.ts [out.json]` prints or saves the same JSON.
- The table shows per flow: done, failed, median seconds of the timed `ok` rows, and the first `ok` run with its
  transaction linked. Below it, the newest `site.proofRuns` runs (config) with every id linked in full (`href`) and
  shortened only in the visible text. BCH links use `connect.explorerTxUrl`; Base links use `evm.chains[].explorer`.
- Crossing rows are shown as measurements whatever the flags say; the text promises no flow.
- The amount column is quoted from the record in English and marked `lang="en"`.
- The front page "Measured" line links to `/how#proof`.

## Rollback

Remove `<ProofTable>` from `HowPage.tsx`; nothing else depends on it.
