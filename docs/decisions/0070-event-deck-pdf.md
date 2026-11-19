# 0070. The event deck is a PDF the site serves itself

Date: 2026-11-19

## Context

The event asks every entry for a banner on its front page with three things: a presentation made from the event's
"Widget Factory" template, a link to the source code and a CashTokens address. The banner already had the address;
`banner.deckUrl` and `banner.repoUrl` were empty, so their links were hidden.

## Decision

- `tools/deck/` prints the deck with Playwright Chromium (`page.pdf`) to `web/public/deck/sampan-blaze-2026.pdf`,
  committed and served by the site at `/deck/sampan-blaze-2026.pdf`. Text stays selectable and links stay clickable;
  fonts are the self-hosted ones (`web/src/fonts`, inlined as data URLs) and colours are the shipped theme's tokens,
  so printing loads nothing from the network (the build refuses any outside request).
- Eight slides in the template's order and with its titles: the product name, the tagline, "Try it in a minute", "The
  Story of Sampan", "Benefits of Sampan", "BCH Usage", "The Vision for Sampan" and the closing slide. The closing
  title is written "Thank you", without the exclamation mark, to match the rest of the public text.
- Every number on a slide must appear in `docs/MEASURED.md`, `config/sampan.json` or the README block that
  `scripts/business-model.ts` makes from config, and every transaction id must be a row of MEASURED
  (`tests/deck.test.ts`). The slide text lives in `tools/deck/content.ts`.
- `banner.deckUrl` is `/deck/sampan-blaze-2026.pdf` and `banner.repoUrl` is `https://github.com/aimanmalib/sampan`.
  The repository becomes public when the entry is submitted; until then that link answers 404 to visitors, which is
  expected. A later deck goes to the same path, so the banner link does not change.
- On a phone the two links would add a 44 px row above the card and push the card's primary button below the first
  screen in Malay and Filipino (measured in WebKit on an iPhone 13: 12 px and 28 px too low). The note and the two
  links now share one paragraph, so on a phone they run on as small inline links after the note's text and the banner
  keeps its height; on a wide screen the paragraph dissolves into the banner row as before, with the note last.
  Links inside a sentence follow the text size, as WCAG 2.5.8 allows; `e2e/front.spec.ts` checks every other target
  for 44 px, as `e2e/a11y.spec.ts` already did.

## Rebuild

`npm run deck` (or `npx tsx tools/deck/build.ts [--copy <path>]`), then commit the PDF.

## Way back

`banner.deckUrl` set to `""` hides the link (config only, then deploy). The PDF can stay in place.
