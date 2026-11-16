# 0028 Sampan Pay webhooks

Date: 2026-11-16

## Context

A merchant's server needs to learn that an invoice (ADR 0027) is settled without polling. The message must be
checkable by the merchant, must not repeat an order when it is retried, must not claim a payment the network does
not have, and must not let anyone point Sampan's server at an address inside the host's network.

## Decision

- Format: Standard Webhooks (standardwebhooks.com, specification Apache-2.0). Headers `webhook-id`,
  `webhook-timestamp` and `webhook-signature: v1,<base64 HMAC-SHA256 of "id.timestamp.body">`; the secret is `whsec_`
  plus base64. Signing uses `node:crypto` only; the reference library `standardwebhooks` is a dev dependency used by the
  tests to check that a merchant using it accepts our messages.
- Events: one per invoice and status, `invoice.paid`, `invoice.underpaid`, `invoice.overpaid`, `invoice.paid_late`,
  `invoice.expired`, queued when the status is settled (`isSettled` in core/pay/status.ts; underpaid only after the
  invoice expired). A later status of the same invoice (an expired invoice paid late) is a new event.
- Queue: table `pay_webhooks` in the same SQLite file (`CREATE TABLE IF NOT EXISTS`, unique on invoice and type), so a
  restart continues it. Every attempt of an event has the same `webhook-id` and body and a fresh timestamp and
  signature. Waits between attempts are `pay.webhook.retrySeconds`; after the last one the event is `failed`. The
  server looks for work every `pay.webhook.tickSeconds`. A 2xx answer ends the event. Redirects are not followed.
- Read back from the network first: before the body is written, every convert or giveBack transaction of the invoice
  is fetched from the Bitcoin Cash servers (not from Sampan's database) and must spend the payment coin and pay the
  merchant's locking bytecode: PUSD of the token category for a convert, BCH for a giveBack. A paid invoice whose
  payment is not converted yet waits; an underpaid one may report a payment that is still waiting at the invoice
  address once that coin is seen there. A mismatch counts as a failed attempt and sends nothing.
  `pay.confirmations` above 0 also asks the server for the transaction's height.
- Address check: https only, no user name in the URL, and every address the host name resolves to must be public
  (loopback, private, carrier-grade NAT, link-local and metadata, multicast, reserved, IPv4-mapped and NAT64 IPv6
  are refused). Checked when the invoice is made and again before each attempt, and the request connects to the
  address that was checked, so a name that changes its answer between the check and the connection cannot reach
  inside. `pay.webhook.allowPrivate` exists for local measurement only and is false in the shipped config.
- Demo shop: `POST /api/pay/demo-hook` is the demo shop's own receiver. It checks the signature with
  `SAMPAN_PAY_DEMO_SECRET` (set on the host, never in the repository) and refuses a timestamp more than five minutes
  away; only then is the demo order marked fulfilled. Without the secret, or with `features.pay` off, it answers 404.
- With the fake network (`SAMPAN_FAKE=1`) no webhook leaves the machine: names resolve to a documentation address and
  the sender answers 503.

## Consequences

- A merchant that was down for longer than the sum of the retry waits misses the event and reads the invoice with
  `GET /api/pay/invoice/:id` instead; the invoice shows `webhook.state` `failed`.
- Undo: the dispatcher is started only when `features.pay` is on; turning the flag off stops all sending.
