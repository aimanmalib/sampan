# 0018 Crossing pre-check and the two-txid tracer

Date: 2026-11-16. Status: accepted.

## Context

Before the first mainnet crossing in either direction, the route's state, its minimums and fees, the memo format and the
test EVM wallet's balances on Base must be known, and a measured crossing needs a record that names the transaction on
both chains. Nothing in this slice sends a transaction.

## Pre-check, read only (2026-11-16 ~09:00 UTC, THORNode via `thorchain.nodes[0]`, Base via `evm.chains[BASE].rpc`)

- `/thorchain/inbound_addresses`: BCH and BASE both `halted: false`, `global_trading_paused: false`,
  `chain_trading_paused: false`. BCH gas rate 3 sat/byte, dust threshold 10000 sats; Base router
  `0x00dc6100103BC402d490aEE3F9a5560cBd91f1d4`.
- `/thorchain/quote/swap` `BCH.BCH` -> `BASE.USDC` to the test EVM address (price at that time about 200.6 USD per BCH):

  | in | expected out | outbound fee | total fee | recommended min in | estimate |
  |---|---|---|---|---|---|
  | 996927 sats (~USD 2) | 1.801196 USDC | 0.249964 USDC | 1102 bps | 393759 sats | 606 s |
  | 1495391 sats (~USD 3) | 2.826744 USDC | 0.249958 USDC | 768 bps | 393759 sats | 606 s |

  The estimate is the BCH inbound confirmation (600 s); outbound delay 0.
- `BASE.USDC` -> `BCH.BCH` to the test BCH address:

  | in | expected out | outbound fee | total fee | recommended min in | estimate |
  |---|---|---|---|---|---|
  | 2 USDC | 846879 sats | 121252 sats | 1128 bps | 0.811794 USDC | 30 s |
  | 3 USDC | 1330927 sats | 121252 sats | 787 bps | 0.811794 USDC | 30 s |

  The outbound fee is flat per crossing, so small amounts pay a large share; the page already shows the fee from the
  quote. The quote's notes for this direction say "Do not swap to smart contract addresses": whether THORChain pays a
  P2SH landing address must be measured in the G3a slice before landing addresses are offered as a destination.
- Memo: THORNode returns `=:BASE.USDC:<0x address>` out and `=:c:<cash address without prefix>` in; Sampan appends
  `:<limit>`. This matches the market swap form `=:ASSET:DESTADDR:LIM` documented at
  https://dev.thorchain.org/concepts/memos.html (read 2026-11-16): `ASSET` "can be shortened", `LIM` is in 1e8 units,
  and UTXO memos are limited to 80 bytes. No change to `core/routes/memo.ts` is needed.
- Test EVM wallet on Base: 0 ETH, 0 USDC, nonce 0. Base gas price 0.006 gwei.

## Decision

- `tools/measure/cross.ts` follows one crossing: THORNode `/thorchain/tx/status/<hash>` (EVM hashes sent without `0x`)
  until the route reports the outbound, then the second chain: a successful Base receipt with a USDC `Transfer` to the
  destination (out), or the BCH txid in the destination's Electrum history (in, g3a), optionally followed by the landing
  conversion. It returns one Runs row whose txid cell is `bch <64 hex> · base 0x<64 hex>` (`· convert <64 hex>` for a
  converted landing) and whose seconds run from the first broadcast to arrival seen on the second chain.
- A crossing the route calls done without a transaction on the expected chain, a Base transaction that reverted or does
  not pay the destination, a refund, and a timeout are all `fail` rows with the reason.
- Gas on Base: the wallet holds no ETH, and two bring-in crossings need two `approve` plus two `depositWithExpiry` calls
  (well under 0.001 ETH at the measured gas price). At the start of the first out slice, one funding swap
  `BCH.BCH` -> `BASE.ETH` of about 500000 sats (above the 393717 sats minimum quoted, under the USD 3 per transaction
  budget) is sent from the test wallet and recorded in the budget ledger; it is not an `out` row. Quote at pre-check:
  750000 sats -> 0.00071578 ETH (outbound fee 0.00013834 ETH).
- The USDC for the bring-in runs is what the measured out runs deliver; no other funding.

## Consequences

The out and in slices only need to broadcast and then call `traceCrossing`; the gate counts a crossing only when both
txids are in the row. Refund rows (a crossing sent back to the source chain) are not traced yet.
Rollback: the tracer is a measurement tool only; deleting it changes nothing on the site.
