# 0032. The ferry follows the crossing answer, not a clock

Date: 2026-11-16. Status: accepted.

## Context

The landing status page drew a small boat whose place came from its own copy of the step count, while the out, in
and swap pages counted their timeline steps with three more private functions. A moving picture of a crossing is only
honest if it moves when the chain moves, and it must not drift from the words in the timeline beside it.

## Decision

- One pure function, `ferryStep(kind, view)` in `web/src/ferry/step.ts`, turns the answer of `GET /api/crossings/:id`
  into the timeline steps, how many are done, the boat's place (1 to `of`), a state (`moving`, `arrived`, `returned`,
  `failed`) and whether money is on board. The four status pages count their timeline with it; the private step
  functions are gone.
- A status the page does not know keeps the first step. The boat never moves ahead of what the server said.
- The boat moves only when the answer changes. The ferry code has no timer of its own; the page's existing poll
  (`landing.pagePollSeconds`) is the only clock.
- Drawing is SVG with CSS `transform` and `opacity` only (no filters, no 3D). The water, pole and bobbing loop only in
  the `moving` state; they stop once the boat has arrived, turned back or failed. Under `prefers-reduced-motion` there
  is no transition and no loop. The ferry is `aria-hidden`; the timeline carries the meaning.
- `ui.ferryMotion` in `config/sampan.json` (default `false`, sent in `/api/config`) is a display setting, not a flow.
  Off: the landing status page shows the ferry still, as before. On: the ferry with motion on every status page and a
  still ferry on the opened landing address card. It stayed off until it had been measured in WebKit on an iPhone 13
  and on the live site; it was switched on on 16 November 2026 after both (`docs/MEASURED.md`, `## Ferry`).

## Consequences

- The timeline and the boat cannot disagree: both are one function call.
- Switching the motion on or off is a config change and a restart, no code change.
- Undo: set `ui.ferryMotion` to `false`; the step function stays, since the timelines read it.
