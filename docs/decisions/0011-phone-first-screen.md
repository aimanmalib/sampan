# 0011 Phone first screen with the judge strip

Date: 2026-11-15. Status: accepted.

## Context

The first screen must show, without scrolling, the headline, the boat picture with both labelled banks, the judge strip and the
action card with its one primary button, on phones and desktops. With the landing flow on, the judge strip adds a row, and on an
iPhone 13 (390x664) the card's button and then the picture fell below the fold. Moving the picture under the card is not an
option: it is part of the first screen.

## Decisions

- **One test for the whole rule.** `e2e/first-screen.spec.ts` runs on the fake server with the landing flow on, in English and
  Malay, on WebKit iPhone 13, 1440x900 and 1280x720. It checks the headline, picture (both bank labels), strip title, Fill, tabs
  and the one primary button lie inside the viewport with no scroll, once the price line has loaded, and that the primary button
  is still inside it after Fill.
- **The hero sub follows the card on phones** when the judge strip is shown (`.hero` becomes `display: contents` under 56rem so
  the sub can take a later grid order). The headline stays the first line; the sub is read right after the card.
- **The landing promise sits under the button.** The text explaining conversion or return now follows the primary button in
  the Bring in panel, so the button stays in view after Fill.
- **The picture is cropped, not shrunk.** The scene's view box drops its empty sky, so it is shorter at the same width on every
  screen.
- **The strip keeps its full title.** Steps fold under it; Fill sits beside it while the title keeps about 7.5rem, otherwise
  below it. Opened steps take the full row so Fill never covers them.
- **Headline in two balanced lines** (`max-width: 24ch`, `text-wrap: balance`) and a slightly smaller top size, so the Malay
  headline no longer takes three lines on desktop.

## Rollback

Revert the CSS in `web/src/land/land.css` and `web/src/styles.css`; the test then shows which element leaves the screen.
