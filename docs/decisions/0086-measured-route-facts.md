# 0086: Measured route facts (time, signatures, fee at USD 2, 20 and 100)

Date: 2026-11-20

## Context

The page should say how long a route takes, how many times a person signs, and what it costs, without a number
typed by hand. Each of the three has a different source of truth.

## Decision

One file, `docs/route-facts.json`, written by `tools/measure/route-facts.ts` (pure parts in `core/route-facts.ts`),
with one entry per live route: Swap on BCH, the landing address, and each Send out and Bring in per chain and route
(THORChain, NEAR Intents) that config marks live.

- **Time**: median, minimum, maximum and count of the ok rows of the Runs table in `docs/MEASURED.md` that carry a
  time and a BCH transaction id; the ids are listed. A route with no such row has `time: null`. THORChain and 1Click
  runs never count for each other. The first THORChain bring-in, logged as `g3a`, counts as `in`.
- **Signatures**: counted by `e2e/route-signatures.spec.ts` on the fake servers. Each BCH transaction the page sends
  passes through `POST /api/broadcast` once; each EVM transaction through the injected wallet's `eth_sendTransaction`
  once. A landing address is made from a typed token address without any wallet, so Sampan asks for no signature
  (`signatures: 0`) and the person pays it once from any BCH wallet (`payments: 1`). Send out is counted from PUSD,
  the panel's default source, which is the swap to BCH plus the deposit.
- **Fee**: quotes from the built server on this host (the same quote endpoints and cost card mapping as the page,
  `core/client/cost.ts`) at USD 2, 20 and 100, each with its UTC time. `usd` is the sum of the named fee parts of the
  card. The price difference (`impact`) is kept apart as `impact_usd`, because it can be negative when the pool price
  is better than the route's, and a negative "fee" would mislead. Swap on BCH and the landing use the Cauldron trade
  parts; the landing counts its contract's convert fee and leaves out the payer's own payment fee. The THORChain
  bring-in includes the approval and router deposit gas priced as the page prices it; the 1Click bring-in leaves gas
  out, as its card does (`network: excluded`). A failed quote is `null` with the server's reason.

No transaction is made and nothing is spent.

## Rerun

    ROUTE_SIGNATURES_OUT=state/route-facts/signatures.json npx playwright test e2e/route-signatures.spec.ts --project=chromium-desktop
    npx tsx tools/measure/route-facts.ts --write

## Undo

Delete `docs/route-facts.json`; nothing reads it until the display step uses it.
