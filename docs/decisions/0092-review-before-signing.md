# 0092: Review before signing

Status: accepted, 2026-11-21

## Context

Swap, Send out and Bring in asked the wallet to sign as soon as the main button was pressed. The numbers were on the
panel (quote line, cost card, address field), but spread over the card, and a first crossing added a separate
disclosure dialog. The wallet prompt itself shows amounts in its own words, so there was no single place in Sampan that
listed what is about to be signed.

## Decision

- One dialog, behind `features.reviewModal`, opens from the main button in all three panels. It lists what is paid,
  what is received (about and at least), the share kept, the total cost, the route, the time and the address, using the
  same quote and cost card the panel shows (`web/src/review/rows.ts`). Lines without a source are left out rather than
  estimated: Swap on BCH has no cost card, so it shows the pool fee and network fee cap instead of a share kept, and no
  time line.
- Before a first crossing the three disclosure lines sit inside the same dialog; confirming it counts as "I understand"
  (the same `localStorage` key as the separate dialog). There is never a second dialog.
- The price keeps refreshing under this dialog (`data-live-quote` on the box; every other dialog still pauses the
  refresh). When any listed number changes, the dialog says "Price updated", and the next press only accepts the new
  numbers. The wallet is asked to sign only after a press on numbers that have not moved since they were shown.
- Escape, Cancel, the close button and a click outside close it without signing. Tab stays inside the dialog (the
  shared dialog frame now traps focus, which the pairing dialogs gain too).
- With the flag off the panels behave as before (sign at once, after the separate disclosure on a first crossing).

## Consequences

- One more press before every signature. The judge path tool presses Confirm when the dialog is shown.
- The fake-server e2e servers keep the flag off, so the older flow specs test the direct path; `e2e/review.spec.ts`
  turns it on in the page and covers the dialog in both engines.
- Way back: set `features.reviewModal` to false in `config/sampan.json`.
