# 0031. Sampan Pay spread without changing the landing contract

Date: 2026-11-16. Status: accepted.

## Context

Sampan Pay needs a way to earn that does not touch `contracts/landing.cash` (its blob is fixed, ADR 0027). The
contract's `convert` asks three things: the landing coin is input 0, output 0 pays the owner at least the floor
(`tokens * rateDen >= sats * rateNum`), and there are as many outputs as inputs. It does not look at the other
outputs. An invoice address's floor is exactly the invoice's PUSD for a payment of `requiredSats`.

## Decision

- `pay.spreadBps` (0 in the shipped config, a gate checks it) adds `ceil(tradeSats * spreadBps / 10000)` to the
  `requiredSats` of new invoices (`core/pay/quote.ts`). With 0 the amount asked is unchanged.
- The finisher then buys exactly the floor for the merchant and adds one pair of its own: a plain coin of the fee
  wallet as the last input, and that coin plus every satoshi left after the floor trade, the miner fee and the
  token dust as the last output, to `business.feeAddress` (`core/tx/spread.ts`). The coin keeps chaining at the
  fee address. Only that input is signed.
- Only invoice addresses (`rateDen` other than 100000000) carry the spread; a plain landing converts all of its
  coin for its owner as before. When there is no fee coin, or the pools ask more than the coin leaves, the finisher
  falls back to the ordinary convert and the merchant gets everything.
- Signing needs a key, so the spread is off wherever no key should be: the server reads `SAMPAN_SPREAD_KEY` only
  when `pay.spreadBps > 0`, refuses to start without it, and refuses a key that is not the key of
  `business.feeAddress`. The public site runs with 0 and never loads a key. A service that turns the spread on
  holds a hot key for one small coin, never for customer funds: payments still leave the invoice address only by
  the contract's two paths.
- Proof: CashScript `MockNetworkProvider` tests (the pair passes; output 0 one unit under the floor fails; a pair
  output without its input fails), a golden hash of the ordinary convert bytes, finisher tests on a fake chain, and
  one local mainnet invoice at 50 bps with the fee address a test wallet address (`tools/measure/pay.ts --spread 50`).

## Undo

Keep `pay.spreadBps` at 0. The pair code is then never reached and no key is read.
