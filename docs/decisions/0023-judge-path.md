# 0023 Judge path: fewer steps to a mainnet transaction id

Date: 2026-11-16

## Context

The judge path stopwatch (`tools/measure/judge-path.ts`, MEASURED.md `## Judge path`, commit 324135c) timed two
paths on the live site. On a phone the "see" path had to scroll past the swap card to the "How it was measured"
link, and that link only appears once `/api/stats` has answered. The judge strip title also promised a
transaction "in about a minute", a time that is not in the Judge path table. No new feature, and nothing new on
the first screen.

## Decision

One line per step, before and after (seconds from page load, from the Judge path rows):

| path | step | before (324135c) | after |
|---|---|---|---|
| see, WebKit iPhone 13 | scroll to "How it was measured" (waits for /api/stats) | 1.9 s, 1 action | removed: the proof link sits in the judge strip's folded steps; one tap opens them |
| see, Chromium desktop | click "How it was measured" under the card | 0.8 s, 1 action | the same link is visible in the open judge steps, no wait for /api/stats |
| see, both | judge strip title claimed "in about a minute" | not measured | removed: "Make a real mainnet transaction yourself." |

Kept, with the reason:

- "Connect wallet" then "Copy link" (do path, two page actions). The pairing link is made after the first tap,
  and WebKit only lets a page write to the clipboard during a tap, so copying it on open is not reliable. On a
  desktop a phone wallet scans the QR code instead and "Copy link" is not used.
- "Swap" (one page action) and the wallet's approval: each moves money, so each stays a choice a person makes.

Measured after the deploy: see the `## Judge path` rows on the commit that holds this file.

## Way back

Remove `judge.proof` from `JudgeStrip.tsx` and the two language files; the "How it was measured" link under the
Measured line is unchanged.
