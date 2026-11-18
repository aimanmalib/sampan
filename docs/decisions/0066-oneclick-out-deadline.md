# 0066. 1Click out deadline covers slow BCH blocks

Date: 2026-11-18

## Context

A real 1Click quote carries a deadline. A deposit that 1Click has not filled by then is refunded to the refund address,
less a refund fee. The deadline for Send out was 30 minutes (`oneClick.deadlineMinutes.out`).

The first measured 1Click Send out (Runs, 2026-11-18T22:53:12Z, 0.0068 BCH to USDC on Ethereum) was sent within a
minute of the quote. Its BCH block came 24 minutes later. 1Click's status moved from waiting to processing 16 minutes
after that block, past the deadline, and the deposit was refunded with reason `QUOTE_EXPIRED` (679500 of 680000 sats back
on BCH, txid `d4ce99ac907c8cd6169150b39001802c96eb6cfc9b8951549e880beb4cf8d234`). BCH blocks average 10 minutes but a
gap of 30 minutes or more is ordinary, so a 30 minute deadline refunds deposits that were sent in time.

## Decision

- `oneClick.deadlineMinutes.out` is 120. Bring in keeps 60: its deposit is on an EVM chain with short blocks.
- New config value `oneClick.minOutDeadlineBchBlocks` (6). Config validation refuses an out deadline shorter than that
  many average BCH blocks (`connect.bchBlockSeconds`), so a value like the old 30 minutes no longer loads.
- The price stays protected by the quote's minimum output (`minAmountOut`, slippage `oneClick.slippageBps`): a longer
  deadline lets 1Click fill later, never below the minimum the page showed.
- The measuring tool `tools/measure/out-run.ts` takes `--route near-intents` and writes `oc-out` rows; it traces the
  crossing through the page's own status endpoint, which asks 1Click by the deposit address. The tracer now stops at
  once on a crossing the route reports failed.

## Rollback

Set `oneClick.deadlineMinutes.out` and `oneClick.minOutDeadlineBchBlocks` back in config. `features.oneClick` is false on
the live site, so this changes nothing visible until 1Click is shown.
