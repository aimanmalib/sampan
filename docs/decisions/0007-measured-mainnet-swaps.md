# 0007 Measured mainnet swaps and the sign request shape

Date: 2026-11-15. Status: accepted.

## Context

Gate G1 asks for three consecutive BCH to PUSD to BCH swaps on mainnet through the page, proof that the pool locks rebuilt from
`owner_pkh` are the ones on chain, and a decision on the shape of the WizardConnect sign request.

## Decisions

- **Measured through the real page.** `tools/measure/swap.ts` starts the built server against mainnet (swap tab on, rate limits
  lifted for its single local address), opens the page in Chromium, takes the pairing link from "Copy link" and hands it to the
  headless test wallet. Each round buys PUSD for 0.001 BCH and sells the whole PUSD balance back. Before each Swap press it waits
  until the page's "at least" line names the right asset and equals a fresh quote, then writes that amount as the test wallet's
  intent. One row per swap goes to `docs/MEASURED.md`, failures included; the run stops at the first failure.
- **Pool locks.** `tools/measure/pools.ts` rebuilds the lock of the largest pools and reads their outpoints from Electrum. Results
  are in `docs/MEASURED.md`.
- **Sign request shape.** The page sends hdwalletv1 `sign_transaction_request` with the unsigned transaction as hex, the source
  outputs in the relay encoding, `broadcast: false`, a one-sentence `userPrompt`, and input paths. The reference wallet library
  (`@wizardconnect/wallet`, used by the test wallet) signed every request on mainnet in this shape. Real wallets (Cashonize web,
  Paytaca on a phone) are recorded in the "Wallets checked" table as they are tried.
- **The broadcast answer waits for the index.** A Fulcrum server accepts a broadcast before its own index lists the new outputs,
  so the page's rescan straight after a swap read the old coins and the server cached them. `/api/broadcast` now polls
  `listunspent` for one output of the new transaction for up to `electrum.indexWaitMs` (every `electrum.indexPollMs`) before it
  answers. When the time runs out it answers anyway; the balance then catches up on the next scan.
- **Test wallet policy.** The `BCH` receive marker is kept as is; only token ids are lowercased. Before this fix the test wallet
  refused every sell (two recorded failures, nothing sent).
- **Swap tab switched on** (`features.swap: true`) after the measured runs.

## Consequences

- A broadcast reply can take up to `electrum.indexWaitMs` longer; the page already shows "Sending" for that step.
- Wallet scans count against `rate.quotesPerMinute`. A person swapping a few times a minute stays far below it; the measuring run
  lifts it locally.
- To undo the tab: set `features.swap` to false in `config/sampan.json`.
