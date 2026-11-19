# 0071. A larger headline and a full-width boat picture on phones

Date: 2026-11-19

## Context

On a phone the front page showed the headline at 28 px and the boat as a strip 36 px high between the two bank
labels, so the picture read as a thin line. The first-screen rule still holds: headline, picture with both banks, the
judge strip and the whole card with its one primary button in view without scrolling, in every language and theme.
Measured in WebKit on an iPhone 13 (390x664) before the change, the card's bottom edge had 16 px to spare in Filipino
(648 px) and 32 to 48 px in the other languages; after it, 5 px in Filipino (659 px) and 21 to 37 px in the others.

## Decision

- Phones at least 40rem (640 px) tall: the headline is `clamp(1.75rem, 8.25vw, 2.75rem)` (32 px on an iPhone 13) with
  no bottom margin, and the picture spans the full width with `aspect-ratio: 640 / 88` (49 px high on an iPhone 13,
  against 36 px before). The SVG uses `preserveAspectRatio="xMidYMin slice"`: the drawing keeps its full width and the
  lower edge of the river is cut (the lowest 26 of 114 units), the same at every phone width. The
  two bank labels sit over the picture's top corners, on the banks.
- Shorter phones (an iPhone SE at 320x568) keep the earlier strip: their card did not fit the first screen before this
  change either, and a taller hero would push it further.
- Wide screens are unchanged: there the picture's height still follows the drawing's own ratio and stays under the
  11rem cap, so the slice fit crops nothing. The link preview image keeps the default `meet` fit.
- Layout only: no colour, theme token, text or animation changes. The bank labels keep `--ink-soft`, which has at least
  6.8:1 contrast on `--paper-deep` and `--paper` in every theme.
- `e2e/first-screen.spec.ts` checks on the iPhone 13 that the headline is at least 32 px and the picture at least 48 px
  high and as wide as the card.

## Way back

Remove the `(max-width: 55.99rem) and (min-height: 40rem)` block in `web/src/styles.css` and the `fit="slice"` in
`web/src/Scene.tsx`.
