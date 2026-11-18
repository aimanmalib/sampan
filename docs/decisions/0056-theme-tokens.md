# 0056: Theme tokens behind one config flag, and the whole card on a phone's first screen

Date: 2026-11-18. Status: accepted.

## Context

Every colour, font, radius and spacing value already came from custom properties on `:root` in `web/src/styles.css`;
no component file held a colour or font literal (checked with a search for hex, `rgb(`, `hsl(` and `font-family`
outside the token block: none). A second look for the page needs those tokens to live in one file per look, with
a single switch to pick one and a single switch to go back.

The first-screen test checked the headline, the picture, the judge strip, the tabs and the primary button, but not
the card as a whole. Adding `section.card` to that list failed on WebKit iPhone 13 (390x664) in every language: the
card ended at 689 px (en), 710 px (ms), 694 px (id) and 713 px (fil); on Chromium 1280x720 it ended at 721 px
(en, id) and 743 px (ms, fil). Its last row, the fee details, sat below the fold.

## Decision

- `config.ui.themes` lists the looks the build carries and `config.ui.theme` names the one the page wears. The list
  must include `paper`, the current look and the way back; the chosen theme must be in the list. `validateConfig`
  enforces both, and a unit test checks that every listed theme has `web/src/themes/<name>.css`.
- Each theme file declares its tokens under `:root[data-theme='<name>']`. `web/src/themes/index.ts` imports every
  file in the folder; only the block whose name matches the HTML attribute applies.
- The build writes `<html data-theme="…">` from config (`%site:theme%` in `web/index.html`, filled by
  `core/page-meta.ts`), so the page draws in its look before any script runs and needs no inline script.
  `/api/config` carries `ui.theme`; the list stays in the file.
- The static error page reads the chosen theme's token block from the built stylesheet, so it wears the same colours.
- On phones (below 56rem) three parts of the first screen are tighter, and nothing else changes: the event banner
  is a two-row grid (the note across the top, the event name over the address label beside the copy button; deck
  and source links, once configured, share one row under them), the boat picture is a strip at most 44 px high with
  a bank label on each side of it, and the closed judge strip has less padding and smaller title text. Every control
  keeps its 44 px touch target. No language text changed.
- On wide screens with the judge strip, the headline spans both columns and the card starts beside the hero sub
  instead of under it; the picture and the judge strip follow the sub in the left column.
- Measured after the change (local fake server, shipped flows): every language passes the whole-card check on WebKit
  iPhone 13, Chromium 1440x900 and 1280x720; at 320 px wide there is no sideways scroll, also with the judge steps
  opened after scrolling.

## Consequences

- Going back to the launch look is `ui.theme: "paper"` and a rebuild.
- A new theme is one CSS file plus one entry in `ui.themes`; components and other stylesheets keep using `var(--…)`.
- The first-screen test now holds the whole card, so a longer text or a new row inside the card shows up as a red
  test instead of a card that ends below the fold.
