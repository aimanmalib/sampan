# 0093: The whole route row picks its route

Status: accepted, 2026-11-21

## Context

In "Choose a route" (Send out, Bring in) each route is a card row about 159 px tall (183 px on an iPhone 13), with the
amount received, fees, time and a "How" disclosure. Only the first line, the radio label, was clickable (44 px, the one
element with `cursor: pointer`). A press on the amount or the time did nothing, while the row looked like one card.

## Decision

- The label's `::after` covers the whole row (`.routes__row { position: relative }`, `.routes__pick::after { inset: 0 }`),
  so a press anywhere on the row is a press on the label and picks that route. No script, no new markup, no new text.
- The radio input and the "How" summary sit above it (`position: relative; z-index: 1`): the radio is still what a click
  on it hits, and "How" opens its own details without changing the choice. Keyboard focus stays on the radio.
- The row shows `cursor: pointer` and a river border on hover; a row that is off shows `cursor: not-allowed`, and its
  disabled radio means a press changes nothing.
- Audit of every `:hover` rule in `web/src`: `.activity__link` (a link), `.evm__wallet` and `.balance` (buttons or
  links) are already clickable over their whole area, so they keep their hover.

## Consequences

- Text inside a row (amount, fees, opened "How" text) can no longer be selected with a drag; the numbers are also on the
  cost card and in the review.
- `e2e/route-row.spec.ts` (Chromium desktop and WebKit iPhone 13) presses the row centre and 8 px above its bottom edge,
  checks the cursor at that point, the "How" summary, an off row, and no overflow at 320 px.
- Rollback: drop the `::after` rule and the row cursor; the label alone picks again.
