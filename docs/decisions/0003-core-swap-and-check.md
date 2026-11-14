# 0003 Pool arithmetic, swap builder and transaction check in core

Date: 2026-11-14. Status: accepted.

## Context

The server builds unsigned BCH transactions and the browser must be able to refuse a wrong one before a wallet sees it. Both sides
need the same pure code, and every transaction must pass the BCH virtual machine before anyone is asked to sign or broadcast.

## Decisions

- **`@cashlab/cauldron` + `@cashlab/common` (ISC) choose the trade** (best rate for a target supply or demand). Each pool leg it
  returns is checked again with our own copy of the pool v0 condition (`core/pools/math.ts`), written with the same integer rounding
  as the script: `(bch_after - fee) * tokens_after >= bch_before * tokens_before`, `fee = |bch_after - bch_before| * 3 / 1000`.
- **The pool locking bytecode is rebuilt from the owner hash** (`core/pools/template.ts`, P2SH32 of the published v0 script) and a
  unit test compares it with cashlab's template compiler for every captured pool.
- **Only the deepest `cauldron.maxPoolsPerTx` pools are offered to the selector**, so a transaction never spends more pools than the
  config allows.
- **We build the swap transaction ourselves** (`core/tx/swap.ts`) instead of cashlab's `createTradeTx`, because the landing contract
  needs a different input order later and the wallet, not the server, signs the user inputs. Layout: pool inputs and their new pool
  outputs at indexes 0..n-1, then user coins, then payout and change. Version 2, locktime 0. Fee: measure with signature-sized
  placeholders, build, measure again, correct once. Change below 546 sats is added to the fee.
- **`@bitauth/libauth` is pinned to 3.1.0-next.6**, the version cashlab already depends on, for one copy in the bundle and the
  2026 VM rules (`createVirtualMachineBch2026`). Before signing only contract inputs are evaluated; after signing, the whole
  transaction.
- **`checkTransaction` (rules 1 to 5)** identifies user inputs by the locking bytecode of their source output. The server supplies
  source outputs, but wallets sign them (SIGHASH_UTXOS), so a false source output invalidates the signature instead of moving funds.
  Inputs that are neither a quoted pool nor a listed user coin are refused; the landing contract input is added with the landing work.
- **Tests run without network** on a frozen capture of real PUSD pools (`tests/fixtures/cauldron-pusd-pools.json`, indexer public
  API) and a test key that never held funds. Sabotage cases (one token more from a pool, wrong signer, foreign output, fee above cap,
  unlisted input) are expected to fail.

## Undo

Replace the selector call in `core/pools/trade.ts`; the builder and check do not depend on cashlab.
