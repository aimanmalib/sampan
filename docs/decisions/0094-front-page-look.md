# 0094: A product look for the front page

Status: accepted, 2026-11-21

## Context

The front page did its job on the first screen: one headline, one card, one primary button, and the swap really works
there. But it read as a tool page. The top bar had a name in plain type and a bare language menu, the picture was a
thin strip, and everything under the card was a few lines of small text, 1,300 px in all. A visitor who gives a
project one minute sees the look before the numbers, and the numbers this project has (every crossing measured on
mainnet, the whole contract in the open) were one click away on /how.

## Decision

- The first screen keeps its content, its order and its heights (ADR 0011, 0071, 0078, 0085). Measured on the fake
  server the specs use: an iPhone 13 has 2 to 5 px to spare in every language, as before; 1280 x 720 has 24 to 42 px,
  up from 13 to 31, because the banner is one row and its note on a wide screen.
- Top bar: the mark of `brand/logo.svg` drawn inline beside the name, both a link to the front page. Section links
  (`/#how`, `/#now`, `/#measured`, the demo and "My activity") show from 64 rem up only, so a phone's first screen is
  no taller. The language menu stays a native select and gains a drawn globe.
- Banner: the address chip is an outline, so the only filled button on the page is the card's. The button keeps its
  44 px target; the outline is drawn smaller inside it.
- Picture: the sampan is redrawn (a hull with a rail, a coin seated in it, a jetty with a mooring post on each bank,
  a far shore, deeper water). Where motion is allowed the boat arrives once from the far jetty and settles in
  midstream, transform only, in under four seconds; with reduced motion it is simply there. A first version ferried
  back and forth without end: motion that starts by itself and runs on needs a way to pause it (WCAG 2.2.2), so it
  does not loop. A wide screen that is also tall (50 rem) draws the picture larger.
- Under the first screen, `web/src/front/Story.tsx` adds four parts, outside `<main>` so the first screen's rules
  (one primary button, no link to Sampan Pay) are untouched:
  - "How Sampan works": each open flow as one crossing (bank, midstream, bank) with the sentence /how gives it, and
    the whole landing contract beside them. The crossing between chains carries the two sentences of the notice
    before a first crossing (who carries it, who signs, what happens when the route cannot finish).
  - "Right now": every chain a crossing reaches, what can be brought in and sent out at this moment and which route
    carries it. A wide screen lays the table out as the river; a phone shows a list.
  - "Measured": the Measured line moved here from under the card, with the newest runs of `docs/MEASURED.md` as a
    logbook (config `site.proofRuns`, failed runs included, every id linked to its explorer). A run carried by the
    1Click route is listed only while `features.oneClick` is on, so the front page names no route it does not offer;
    /how lists every run whatever the flags say.
  - Doors to the demo video, Sampan Pay (each behind its flag) and the risks page.
- No sentence is new. Every string is a lang key the hero, /how, the footer or the pages behind the doors already
  show, so the four languages and their review carry over. Every number comes from config, `GET /api/health`,
  `GET /api/depth` or `docs/MEASURED.md` as built into the page. A flow whose flag is off is not drawn, and a crossing
  between chains only while the route's last health check sees it open (the hero's rule).
- Footer: a deep band on every page, with the sentence about the boat set large and the crossing drawn once more.
- Each theme gains the tokens the deep band needs (`--deep`, `--deep-ink`, `--deep-soft`, `--deep-line`, `--deep-ok`,
  `--deep-danger`) and `--river-deep`. No colour is written outside the theme files.
- While the peg warning shows on a phone it reads at the size of the price line above it, so the card's primary
  button stays on the first screen (it sat 8 px below it with a three-line warning).
- The finish over the older sheets lives in one file, `web/src/look.css`, loaded last. No filter, no blur, no new
  font, no third-party request, no change to the Content Security Policy.
- Every hover added here is on a control that is clickable over its whole area (links, buttons, tabs, the language
  select), the rule of ADR 0093. A button's fill does not fade: when a button turns from disabled to enabled its text
  and its ground change together, at once. A first version faded the fill, and in the linen theme run WebKit's
  contrast check caught the primary button between the two states (2 of 8 repeats, none of 24 without the fade).

## Consequences

- The page is about 5,100 px tall on a wide screen and 7,300 px on a phone.
- The way back is a revert of this step's commits. To keep the new parts and drop only the finish, remove the
  `look.css` import in `web/src/main.tsx`; to drop the parts under the card, remove the `Story` line in
  `web/src/App.tsx` and put `<Measured link />` back under the card.
- The demo video and the deck were made with the earlier look and still show it. The README pictures are retaken
  with this step. `og.png` is unchanged (`npm run og-image` reads the stylesheets without a theme file, so it is
  not run here).
- The status page already owns the class `crossing`, so the flow drawing uses `wake`.
- Text under the card can meet a spec that looks a string up on the whole page. Two did on the first full run: a
  sentence that listed "USDT on BNB Smart Chain" beside the card's network list, and a logbook row named for the
  1Click route on a server with that route off. Both are why the two rules above exist.
- Without its stylesheet the front page is now wider than a phone (the contract and the logbook table do not wrap),
  as /how already was. A spec that measures the front page at 320 px therefore fails when the stylesheet does not
  load, where before it passed without noticing.
- `e2e/story.spec.ts` checks the parts under the card, the top bar links and the river in both engines. The river's
  contrast in the three other themes was checked by hand with axe (the theme run of the gate does not include it).
- The card keeps its one-pixel edge and gets no wide shadow. A first version gave it one (a 40 px blur): WebKit drew
  that blur again at every change inside the tall card, and the spec that clicks through the route rows took 13 to
  16 s where main takes 4 to 6 s. Without the shadow it takes the same as on main. The contrast check has more to
  read on the front page, with no difference in time that could be measured once the shadow was gone.
