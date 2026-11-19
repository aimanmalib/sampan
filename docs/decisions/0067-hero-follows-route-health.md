# 0067. The hero line follows the route's live state

Date: 2026-11-19

## Context

The line under the page title said "Bring USDC and USDT in as PUSD ... send PUSD out as ..." whenever the config switched
crossings on. The config does not change when THORChain halts a chain, so on 2026-11-18 the live page promised crossings
while every crossing tab read "Paused by the route". The text described the flags, not what a visitor could do.

## Decision

- `openFlows(config, health)` in `core/flows.ts` takes the page's last `/api/health` report. A crossing is promised only
  when the flags open it, the report says the route is open (`route.open === true`), and at least one live asset sits on
  a chain the report marks open. The open chains come from `networkStatus` in `core/cross-choices.ts`, the same per-chain
  status the network lists use (ADR 0064), so there is one map, not two.
- `{symbols}` in the line names only the assets on open chains (`openSymbols`).
- No report yet, an unknown check (`open: null`) or a failed request means no crossing is promised. This is stricter than
  the server, which still quotes while the state is unknown: the text does not promise what has not been checked.
- A route that reports itself halted is not promised even where its chain map still marks chains open.
- The line is recomputed on every health poll (`health.intervalSeconds`), so it changes without a reload.
- The description written into the HTML when it is served (`description`, `og:description`, `twitter:description`)
  never promises a crossing (`staticDescriptionKey` in `core/page-meta.ts`): link previews are cached elsewhere and read
  later, when the route may have paused. It uses the existing key for the other open flows, so no new text is needed.
  The page sets its own description from the live state once it runs.
- Tabs, terms and the "how it works" page keep `openFlows(config)` without a report: a paused chain stays listed as
  paused (ADR 0064) instead of its tab disappearing.

## Tests

`tests/hero-truth.test.ts` (halted, unknown, one chain open, Bitcoin Cash halted, 1Click carrying a chain THORChain halts,
link preview text) and `e2e/hero-truth.spec.ts` on both engines against the fake THORNode (open, reported halted, only
Ethereum open). Removing the `route.open` condition turns both red.

## Rollback

Call `openFlows(config)` without the report in `web/src/App.tsx` and use `descriptionKey(openFlows(config))` in
`core/page-meta.ts`.
