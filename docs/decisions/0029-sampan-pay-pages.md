# 0029 Sampan Pay pages, demo shop and button script

Date: 2026-11-16

## Context

Invoices (0027) and webhooks (0028) have an API but no page a customer pays on, no way for a merchant to see the
flow working, and nothing to drop into a shop page. All of it must stay hidden while `features.pay` is off.

## Decision

- `/pay/i/:id` is the customer's page: amount in BCH, address, QR code and BIP21 link ("Open in wallet"), time left,
  the status in plain words, and the payment and convert transactions. The address is shown only while a payment can
  still count (open, or underpaid before the time is up); an expired invoice says not to pay it. Each status says
  where the money went, after 0027: underpaid and late payments still reach the shop, so refunds are the shop's call.
  The page asks again every `landing.pagePollSeconds` while something can still change. The logic is a pure module
  (`web/src/pay/invoice-state.ts`).
- `/pay` is for merchants: a demo shop with one order at `pay.demo.priceUsd`, paid to a token address of the
  project's test wallet, then the API in four parts with samples built from the page origin and config.
  `POST /api/pay/demo/order` makes the invoice with the demo hook as its webhook and `SAMPAN_PAY_DEMO_SECRET` as its
  secret; `GET /api/pay/demo/order/:id` tells the status page when the demo hook has checked the signed message and
  handed the order over. Without the host secret both routes are 404.
- `web/public/pay.js` is a small script with no text of its own: `data-sampan-invoice` opens the status page of an
  invoice the merchant's server made (recommended, since only a server can hold a webhook secret);
  `data-sampan-usd` and `data-sampan-merchant` make an invoice from the browser without a webhook;
  `data-sampan-demo` is the demo order. It opens the tab inside the click so pop-up blockers allow it, and builds the
  status URL from its own origin. `/pay/example.html` shows it; it is a developer sample in English, like the README.
- Flag off: no footer link, no line on `/how`, `/pay` falls back to the front page like any unknown page, and
  `pay.js`, `example.html` and its style sheet are the static 404 page (`registerPayFiles`).
- Fake network (tests only): `POST /api/pay/fake/pay/:id` pays an invoice address on the fake chain and
  `/api/pay/fake/expire/:id` moves its expiry to now. The demo shop's webhook is answered in-process by the demo hook
  of the same server, still signed and checked; every other webhook address gets 503 as before. None of these routes
  exist on the real network.

## Consequences

- `e2e/pay.spec.ts` runs against its own fake server with Pay on (port offset `PAY_PORT_OFFSET`); `a11y.spec.ts` and
  `first-screen.spec.ts` cover both Pay pages.
- `pay.js` is not fingerprinted, so a CDN may serve an older copy for a few hours after a change; the script's
  attributes are the contract and only grow.
- Undo: switch `features.pay` off; nothing else on the site depends on these pages.
