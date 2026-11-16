# 0030. Measuring Sampan Pay on mainnet before turning it on

Date: 2026-11-16. Status: accepted.

## Context

`features.pay` may only be true once two mainnet invoices were paid, converted and announced by webhook, at least
one of them by an ordinary BCH payment (not WizardConnect). Webhooks are https only and refuse private addresses;
the live site keeps that. The measurement runs the built server on our own machine, so its receiver is local.

## Decision

- `tools/measure/pay.ts` starts `dist/` with `features.pay` and `pay.webhook.allowPrivate` switched on by
  `SAMPAN_CONFIG_PATCH`, and an HTTPS receiver on `127.0.0.1` with a self-signed certificate made for that run
  (`openssl`, deleted afterwards). Only the spawned server trusts it, through `NODE_EXTRA_CA_CERTS`; TLS checking
  in the webhook sender is not relaxed. The receiver checks each message with the same `checkWebhook` a merchant
  would run.
- The invoice is made through `POST /api/pay/invoice` with that receiver as `webhookUrl`, for
  `pay.demo.merchantAddress`. The demo shop's own hook needs the public site URL, so it is measured live (next step).
- A row is ok only when the invoice is `paid`, the payment and the conversion are both on Electrum, the PUSD output
  is at the merchant address and the receiver accepted an `invoice.paid` signature for that invoice
  (`tools/measure/pay-run.ts`, unit tested including each failure).
- `pay.demo.merchantAddress` moves to an unused receive address of the test wallet, so the merchant is never one of
  the addresses the payment spends from.
- The 0.20 USD demo price stays: both invoices converted at that amount (MEASURED, Sampan Pay runs).
- `pay` rows stay out of the `/how` proof table for now; they were measured on a local server.

## Undo

Set `features.pay` to false; the measured rows stay as a record.
