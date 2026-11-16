# 0022 Sampan fee lives in config, 0 on the public site

Date: 2026-11-16

## Context

A swap could carry a fee for the service, but during the event the fee is 0 (product spec, out of scope:
"Sampan fee, 0 during the event"). Changing it later should not need a code change, and a fee must never let
the server move more of the user's money than the page showed.

## Decision

- `config.business` holds `feeBps`, `feeAddress` (a P2PKH cash address), and the inputs of the scenario table
  (`scenarioBps`, `scenarioShares`, `sources`). `feeBps` is 0 in the tracked config.
- When `feeBps > 0`, the swap builder adds one plain BCH output to `feeAddress`, placed last, worth
  `floor(BCH side × feeBps / 10000)`. The BCH side is what the pools take in (buy) or pay out (sell). A fee
  below the dust limit (546 sats) is left out and the quote says 0. For a buy it comes out of the BCH change,
  for a sell out of the proceeds; the sell minimum shown is already net of the fee.
- With no fee, or a fee of 0, the transaction bytes are exactly those of a swap before the fee existed
  (golden test on the fixture pools).
- `checkTransaction` gets the fee from the page's own copy of the config (`/api/config` exposes `feeBps` and
  `feeAddress` only) and recomputes the amount from the pool outputs in the transaction. One output to the
  fee address of exactly that amount is accepted; another amount there is rule 3, a fee to any other address
  is rule 1, a missing fee is rule 3. With the fee off, any output to the fee address that is not the user's
  own is refused.
- The "Fees" panel names the Sampan fee ("none" while it is 0) and, when a quote carries one, its amount.
- Landing addresses carry no Sampan fee: the contract is not changed.
- The fee is measured on mainnet with a local built server and `SAMPAN_CONFIG_PATCH`, paying the fee to the
  test wallet's own address (`tools/measure/swap.ts --fee-bps N --fee-address …`). The public site is not
  redeployed for this.

## Way back

Set `feeBps` to 0 (it is 0 now). The fee output code is inert at 0.
