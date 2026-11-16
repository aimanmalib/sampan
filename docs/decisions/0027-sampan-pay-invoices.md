# 0027 Sampan Pay invoices on the landing contract

Date: 2026-11-16

## Context

A merchant wants to be paid in BCH and keep a stable amount. A landing address already does that for one owner:
any BCH that reaches it converts to PUSD for the owner at a rate at or above a floor, or goes back to the owner as
BCH. An invoice needs one more thing: its own address, so that a payment can be matched to it, without a change to
`contracts/landing.cash` (the measured contract stays the one that runs).

## Decision

- An invoice is a landing address whose owner is the merchant's token-aware address and whose token is PUSD. The
  contract is not changed. Each invoice gets its own address from an existing parameter: `rateDen` is
  `100000000 + nonce`, with the nonce drawn at random from 1 to `pay.maxNonce` and never shared with another open
  invoice of the same merchant (an address that already exists is drawn again). `rateNum` is scaled with it, so the
  rate is the same as with `rateDen` 100000000.
- `landingParamsProblem` and `readCard` accept a nonce only when the caller passes the range (`pay.maxNonce`, at most
  `LANDING_NONCE_CEILING`); with no range a card must have `rateDen` 100000000 as before. The landing finisher and
  `scripts/finisher.ts` pass the configured range; `scripts/verify-landing.ts` accepts the whole ceiling, since its job
  is to check that an address is this contract.
- Price: `requiredSats` is what the pools ask for the invoice's PUSD at quote time, plus `pay.quoteBufferBps`, plus the
  convert fee and token dust from `landing`. `rateNum` is rounded down so that the contract floor for a payment of
  `requiredSats` is exactly the invoice amount in PUSD units; rounding up would ask the pools for one unit more.
- Status uses the vocabulary of BTCPay Greenfield: `open`, `paid`, `underpaid`, `overpaid`, `expired`, `paid_late`.
  It is recomputed from the payments the finisher reported (summed), the time and `pay.underToleranceBps` /
  `pay.overToleranceBps` (core/pay/status.ts). The contract does not know the time, so a payment after `expiresAt`
  still reaches the merchant and is reported as `paid_late`. An underpaid invoice converts what was paid, or returns
  it to the merchant as BCH when the pools cannot meet the floor; the payer cannot be refunded by the contract, so
  refunds are the merchant's call.
- The landing watcher is unchanged in what it does; it now tells a listener what happened to each coin (with the
  coin's value and the PUSD received). The Pay module only reads that; it never builds or signs a transaction.
- Invoices live in a new table `pay_invoices`, added with `CREATE TABLE IF NOT EXISTS`; no table is rebuilt.
- API: `POST /api/pay/invoice`, `GET /api/pay/invoice/:id` and its `qr.svg`. No accounts: the id is 128 random bits,
  creation is limited per IP by `rate.invoicesPerHour`, and open invoices per merchant by `pay.maxOpenInvoices`.
  `/api/pay/*` is the only path that answers any origin (CORS without credentials), because merchants call it from
  their own pages; everything else stays same-origin.
- Everything sits behind `features.pay`, off until invoices are measured on mainnet; off means every `/api/pay` route
  answers 404. Webhooks, the status page and the demo shop come in later steps.

## Consequences

- The contract, its artifact and every existing landing address are unchanged (a measured mainnet landing address is
  recomputed in tests/pay-core.test.ts).
- An invoice crossing is a `land` crossing with route `pay`; a merchant's invoices count as landings by other people
  in `/api/stats` unless the merchant address is a team address.
- Anyone can still finish an invoice address with its recovery card, as for any landing.
