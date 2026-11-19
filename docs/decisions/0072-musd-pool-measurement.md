# 0072. MUSD pools measured; MUSD stays off until two swaps are measured

Date: 2026-11-19

## Context

PUSD is the token Sampan offers. MUSD has a token entry in `config/sampan.json` behind `features.musd` (false). Before
it is offered, the Cauldron pools for it must be deep enough that a small swap gets close to the pool price in both
directions, and every pool must be a real pool: the locking bytecode rebuilt from the pool owner's key hash holds the
coins the indexer names (the same check the server makes for PUSD, ADR 0007).

## Measurement

`npx tsx tools/measure/token-pools.ts <TOKEN> [sats]` reads the pools from the indexer in config, keeps only those whose
rebuilt lock is found on Electrum (the server's `PoolDirectory`), sums them, then prices a BCH to token swap of the given
size and the swap of the tokens received back to BCH with the server's own trade selection (`core/pools/trade.ts`).
Slip is (price of the deepest pool - price received) / price of the deepest pool, both as units received per unit given;
it includes the 0.3 % pool fee. No transaction is made.

Measured 2026-11-19 between 12:59 and 13:01 UTC, indexer `https://indexer.cauldron.quest`:

| token | pools listed | lock checked | BCH in pools | tokens in pools |
|---|---|---|---|---|
| MUSD | 47 | 47 | 79.32798527 | 16364.07 |
| PUSD | 58 | 58 | 517.05215993 | 107978.51 |

| swap | gives | gets | pools used | slip |
|---|---|---|---|---|
| BCH to MUSD | 97239 sats | 0.2 MUSD | 2 | 0.31 % |
| MUSD to BCH | 0.2 MUSD | 96653 sats | 1 | 0.31 % |
| BCH to MUSD | 1497799 sats | 3.08 MUSD | 2 | 0.33 % |
| MUSD to BCH | 3.08 MUSD | 1488149 sats | 2 | 0.33 % |
| BCH to PUSD | 96006 sats | 0.2 PUSD | 1 | 0.30 % |
| PUSD to BCH | 0.2 PUSD | 95691 sats | 1 | 0.03 % |

The first rows ask for 0.001 BCH (100000 sats); the trade selection gives fewer sats because the token has two
decimals and the amount received is a whole number of cents. The larger rows ask for 1500000 sats, near the per swap
limit in config.

## Decision

- Slip is under 2 % in both directions at both sizes, so MUSD may be offered, but not yet: `features.musd` stays false
  until two mainnet swaps with the test wallet (BCH to MUSD and MUSD to BCH, measured with `tools/measure/swap.ts` on a
  local build with the flag patched on) are recorded as `swap ok` rows in `docs/MEASURED.md`. Those swaps are made only
  when the day's test budget allows it.
- If the swaps are not made before the code freeze, MUSD stays off and this record stands as the reason.
- MUSD pools hold about one sixth of the BCH in PUSD pools; the numbers above are a reading at one time, and the tool is
  the way to read them again.

## Way back

Nothing in the product changed. Turning MUSD on later is the one flag; turning it off again is the same flag.
