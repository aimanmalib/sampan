# 0068. "Watch it run": a replay of one measured landing, no wallet

Date: 2026-11-19

## Context

Seeing a landing work today needs a BCH wallet and a payment. A visitor without one, or a judge on a phone, gets only
the proof table. A replay of a run that really happened shows the flow without asking for funds, as long as it never
looks like a live transaction and every number in it comes from the measurements.

## Decision

- `/watch?dir=land` replays the landing run `site.watch.land` names: an ok `land` row of the Runs table in
  `docs/MEASURED.md` with a measured time, read when the page is built (the same `virtual:sampan-proof` data the proof
  table uses). Nothing is fetched, built, signed or sent; `web/src/watch/` imports no wallet or broadcast code.
- Three steps (a wallet pays BCH to a landing address, the address swaps it for PUSD in one transaction, PUSD arrives
  at the owner's address). Each step links the run's real transaction in the explorer from config. The Runs row holds
  one id for a landing, the conversion; its input is the payment and its output the PUSD, so all three steps link it.
- The wallet is labelled "play money, nothing is sent".
- Pace: each step lasts `site.watch.stepMs`. The line under the steps compares the replay with the measured time and
  says "faster", "slowed down" or "real speed" with the factor (`core/watch.ts`). A landing takes seconds, so the replay
  is usually slower than the real run; the text says so rather than claiming a speed-up.
- Motion is CSS only, `transform` and `opacity`; the end of the last step's animation marks the replay done (an event,
  no timers). With `prefers-reduced-motion` every step shows at once.
- `features.watchDemo` (off by default) gates it. Off: the server answers `/watch` with the static 404 page and the
  judge box has no link. On, but the run is not in the build or `dir` is unknown: the page shows the not-found text.
- The judge box links to the replay inside its folded steps, so the first screen does not change.

## Consequences

- Choosing another run is a config change (`site.watch.land`); a unit test checks that the shipped id is in the
  measurements.
- Crossing directions (`dir=out`, `dir=in`) can be added to the same page later through `WATCH_DIRS`.
- Rollback: set `features.watchDemo` to false.
