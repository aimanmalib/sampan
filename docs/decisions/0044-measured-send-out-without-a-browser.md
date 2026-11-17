# 0044: Measured Send out without a browser

Date: 2026-11-17. Status: accepted.

## Context

The first Send out runs on mainnet (PUSD to USDC on Ethereum through THORChain) must be measured and written to
`docs/MEASURED.md`. The swap and landing tools drive the page in Chromium with the test wallet paired over
WizardConnect, and the test wallet's policy only knows swaps and plain payments: it has no rule for a route deposit
with a memo output. Teaching it a second copy of the deposit rules would duplicate what the page already checks.

## Decision

- `tools/measure/out-run.ts` runs the page's own client code (`core/client/out.ts` `runOut`: quote, step 1 Cauldron
  swap, step 2 route deposit, each built by the server and checked with `checkTransaction` before signing) against
  the built server on this host, with `compliance.crossChainEnabled` and the one measured asset switched on through
  `SAMPAN_CONFIG_PATCH`. The public config is not changed.
- The mainnet test wallet signs through a `WalletSession` made from the env file phrase. It is called only after
  `runOut`'s checks passed on the exact transaction. The run is refused before anything is signed when the quote's
  USD value passes `state/budget.json`; each signature is written to the test ledger (the value counted once).
- The cost card of the signed quote is saved to `state/cost-shown/<txid>.json` after signing and before broadcast
  (ADR 0043). The crossing is then traced with `traceCrossing` (`tools/measure/cross.ts`), and one Runs row is
  appended with `--write`. Seconds run from the first signature, so a stablecoin source includes the Cauldron swap.
- Memo form checked on 2026-11-17 against https://dev.thorchain.org/concepts/memos.html: `=:ASSET:DESTADDR:LIM` is a
  market swap with a minimum output, and assets may be abbreviated (`ETH.USDC`). The server takes the memo from the
  THORNode quote and the page checks it names the typed address and at least the shown minimum.

## Consequences

- The page's rendering and wallet prompt are not part of these runs; the page flow is covered by the e2e tests with
  a fake route. The judge path keeps measuring the page itself.
- Way back: the runs can be repeated through the page once the test wallet's policy learns route deposits.
