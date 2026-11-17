# 0047: A payment seen closes the QR code first, then the ferry crosses and arrives

Date: 2026-11-17. Status: accepted.

## Context

Organiser feedback in the event chat, 17 Nov, on payment pages in general: once a payment is in, close the payment QR
code by itself first and only then play the success animation, so that the animation is seen. Before this change the
landing card kept its QR code open until the visitor left for the status page, and the Sampan Pay invoice page swapped
the QR code for a status line with no transition. A landing paid from another wallet was not noticed by the card at
all; only the status page polled.

## Decision

- `web/src/ferry/reveal.ts` is a pure function of the moments the page saw the payment and the landing, the time now,
  two durations and reduced motion: `qr`, `closing`, `moving`, `arriving`, `done`. It never runs backwards and never
  lets the ferry move or arrive while the QR is not closed. A landing seen in the same answer as its payment still
  shows the ferry moving for one more beat (the QR close time) before the arrival, so the order stays visible.
  Unit tests: `tests/ferry-reveal.test.ts`.
- DOM contract for tests and tools: the QR wrapper carries `data-qr="open|closing|closed"` (closed leaves the layout,
  no QR code in the page), the ferry `data-arrive="idle|moving|playing|done"`.
- Durations live in config: `ui.qrCloseMs` (shipped 400, 150 to 1500) and `ui.arriveMs` (shipped 2400, 800 to 6000),
  validated and sent in `/api/config`. They reach the CSS as custom properties set through the CSSOM, so the CSP still
  needs no inline style attribute.
- The timer that wakes the page at the end of a phase lives in `web/src/land/useReveal.ts`, not in `web/src/ferry/`.
  Where the boat stands still comes only from the crossing answer (`step.ts`); the timer only decides how soon the page
  may show the next part. One timeout at a time, none once the ferry is moving or done.
- Landing card (`web/src/land/LandOpen.tsx`): while its QR is open it asks `GET /api/crossings/:id` every
  `landing.pagePollSeconds`, only while the tab is visible (no kick, so no quote budget is spent). A payment from the
  connected wallet counts as seen at once. Once the QR has closed the ferry is scrolled to the middle of the screen
  (instant with reduced motion). A wallet payment still leads to the status link, but only when the arrival is over.
  An address that was reused and had already landed keeps its old status whatever arrives next, so the card does not
  watch it and does not play an arrival for it; a wallet payment there goes to the status link once the QR has closed.
- Invoice page: a change from payable to paid that this page sees runs the same order, with the ferry from Bitcoin
  Cash to the shop's token and "Payment seen" words. A page opened on an invoice already paid shows the end state at
  once, with no closing and no words.
- The arrival is one pass: the coin steps ashore and one ring spreads on the far bank, `transform` and `opacity` only,
  no `filter`, no loop. Reduced motion: no closing, no arrival, end state at once. No sound.
- Fake network only: `POST /api/landing/fake/pay/:id` pays a landing address from outside the page, so
  `e2e/qr-close.spec.ts` can check the card noticing it by itself.

## Consequences

- `e2e/qr-close.spec.ts` (Chromium desktop and WebKit iPhone 13) records when each value of `data-qr` and
  `data-arrive` first appears and checks closing, closed, moving, playing, done in that order, no QR code during the
  arrival and the ferry inside the viewport while it plays, for a landing paid from outside, a landing paid from the
  wallet and an invoice; and no closing or arrival with reduced motion. Letting the ferry move while the QR is still
  closing turns it red.
- The judge path through the wallet now reaches the status page after the arrival (a few seconds later than before).
- Rollback: `ui.ferryMotion: false` removes the ferry and its arrival (the QR still closes first); the reveal itself
  has no separate flag, its shortest form is `qrCloseMs: 150` and `arriveMs: 800`.
