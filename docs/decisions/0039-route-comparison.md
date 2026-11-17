# 0039: Comparing the THORChain route with the atomic swap route

Date: 2026-11-17

## Context

Send out and Bring in use THORChain today. A second route, an atomic swap between PUSD on Bitcoin Cash and USDC on
Base, has its own service under `/atom/api` on the same host. Its integration note asks a site that offers both to
show cost from the live quote, time from the measured median, and the trust model, and to show a refused quote as
unavailable with its reason rather than hide it. How its client ships is recorded separately; this record covers only the
comparison, which needs no client file.

## Decision

- `core/routes/compare.ts` is one pure function, `compareRoutes`, with no network or file access. It gets the
  THORChain quote the page already holds (or its error code), the atom quote (or null when the atom route is not
  shown), the measured runs and two config values, and returns one row per route.
- Flow mapping: Send out from PUSD to USDC on Base is `pusd-to-usdc`; Bring in of USDC on Base received as PUSD is
  `usdc-to-pusd`. Any other source, asset or chain has no atom row at all (not an unavailable row), and neither has a
  flow missing from the offered list in config.
- Cost: the amount received for the same input, from each live quote, and fees exactly as each route reports them:
  THORChain in the received asset, the atom route in Base gas units and BCH satoshis. Nothing is converted to USD,
  so no price is computed here.
- Time: the measured median and its count. THORChain uses the `out`/`in` rows of `docs/MEASURED.md` (the existing
  parser); the atom route uses `measured.medianSeconds` from its own quote. No measurement shows as not measured
  yet; THORChain's own estimate is kept apart as an estimate. Lock timeouts are trust facts, never times.
- An atom quote that refused (`inventory`, `below-min`, `above-max`, `daily-limit`, other) is an unavailable row with
  its reason. A quote for a different amount (`stale`) or flow (`wrong-flow`) is also unavailable rather than
  compared.
- "Receives more" is set only when both rows are available, in the same asset, and differ. Bring in compares BCH
  from THORChain with PUSD from the atom route, so it carries no label. The selection is always THORChain; the user
  picks another row.
- Team wallets: `SAMPAN_TEST_ADDRESSES` now also takes EVM addresses (`0x` and 40 hex digits, matched in lower case),
  since Send out rows store the Base destination. Cash addresses are matched by locking script, so a token-aware
  `z…` address matches its plain form.

## Evidence

- `tests/fixtures/atom/` holds the health answer and three quotes recorded once with GET from the live API on
  2026-11-17: `usdc-to-pusd` for 2, `pusd-to-usdc` for 1, and `pusd-to-usdc` for 2, refused with `inventory`.
- `tests/route-compare.test.ts` and `server/origin.test.ts` cover the rules above, including the four public test
  wallet addresses of the atom route (two on Base, two token-aware on Bitcoin Cash).

## Undo

Delete `core/routes/compare.ts` and its test; nothing imports it yet. The EVM match in `server/origin.ts` only adds
keys; removing it returns the previous behaviour.
