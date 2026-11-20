# 0085: The main message in the first minute, without the video

Date: 2026-11-20

## Context

A reviewer may never press play on the demo video. What Sampan is, who it is for and the proof that it works have
to be readable on the first screen in about fifteen seconds, on a phone and on a desktop, next to the swap card,
the boat picture and the judging strip that the first screen already holds (ADR 0053, ADR 0071).

## Decision

- Three lang keys in every language: `pitch.what` (the headline), `pitch.why` (one sentence for people paid in BCH
  and people holding USDC or USDT) and `pitch.proof`. English stays at 45 words or fewer (`tests/pitch.test.ts`).
- `pitch.why` names the open stablecoins through `{symbols}`, from config and the route's health like the hero sub;
  while no crossing is open, `pitch.whyBch` says the BCH half only. No asset name is typed in a lang file.
- The proof's numbers are placeholders filled from the front page headline that `scripts/measured-json.ts` counts
  from `docs/MEASURED.md` with the README bounty-table counter (`core/pitch.ts`). No number is typed. The proof is a
  link to the table of every transaction on `/how#proof`.
- The hero's headline is now `pitch.what`, followed by why and proof (`web/src/HeroPitch.tsx`). Slide 1 of the PDF
  deck reads the same keys in English (`tools/deck/build.ts`), so the page and the deck cannot drift.
- Desktop: the pitch takes the row under the headline, beside the top of the card. Phone: the pitch is 12 px type
  close under the headline, and the space it needs comes from tighter spacing (page gap, top bar, card padding, event
  banner padding). The Malay, Indonesian and Filipino banner note and the Filipino address label are shorter so the
  banner keeps two text rows. `e2e/first-screen.spec.ts` checks headline, why, proof, picture, judging strip and the
  whole card without scrolling in every language, on an iPhone 13 and at 1440x900 and 1280x720.

## Undo

Render `hero.title` in place of `HeroPitch` in `web/src/App.tsx` and drop the `.hero__pitch` rules; the lang keys
can stay unused.
