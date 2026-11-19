# 0069. The judge steps start open, on a phone under the card

Date: 2026-11-19

## Context

The "Judging?" box on the front page folded its steps under its title on phones and on short wide screens, so a judge
had to find and tap the title before seeing the steps, the replay link and the proof link. Opening the box in place
does not fit: measured in WebKit on an iPhone 13 (390x664), the open steps add 194 px above the card while the card's
primary button has 85 to 117 px to spare, depending on the language. On a 1280x720 desktop the open steps push
"Fill this in for me" to 732 to 779 px, below the screen. The first-screen rule (headline, picture, judge title, Fill
and the card's one primary button in view without scrolling, every language and theme) stays.

## Decision

- `config.judge.openOnPhone` (shipped `true`) opens the steps without a tap on every screen size.
- Phones (under the 56rem breakpoint): the strip above the card keeps the title and Fill only; the title is a link to
  the open box, which sits right under the card (`details#judge-box`, summary "Steps for judges"). One tap on the title
  brings the proof link into view.
- Wide screens: the box stays in the left column and opens there; Fill moves beside the title, so the open steps grow
  the box downwards without pushing Fill off a 1280x720 screen.
- The box holds the two steps, then "Watch a landing run" (only while `features.watchDemo` is on, ADR 0068), then the
  proof link. A "Try to cheat it" link joins it when that panel exists.
- `docs/JUDGE.md` is the same walk in text, every transaction id a row of `docs/MEASURED.md`, linked first from the
  README. `tools/measure/judge-path.ts --judge-md` times it in WebKit on an iPhone 13: taps from load to an explorer
  page (`judge-md` row), and to a refusal on the cheat panel (`judge-md-cheat`, no row while the panel is off).

## Consequences

- `e2e/judge-open.spec.ts` checks both settings in both engines; `e2e/first-screen.spec.ts` is unchanged and passes
  with the box open. The two older 320 px tests of the folded strip in `e2e/land.spec.ts` now set the flag off.
- Way back: `judge.openOnPhone: false` in the config file brings back the folded strip on every screen (the wide layout
  keeps Fill beside the title). No rebuild of the page code is needed, only a restart with the new config.
