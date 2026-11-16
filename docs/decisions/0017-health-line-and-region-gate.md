# 0017 Health line, route pause and region gate

Date: 2026-11-16. Status: accepted.

## Context

The page depends on the Cauldron indexer, the Bitcoin Cash servers and, for crossings, the active route. Visitors should see
the state of each, a halted route should stop new crossings without a deploy, and crossings must not be offered in the
countries listed in `compliance.blockedCountries`.

## Decision

- `server/health.ts` checks every `ops.healthIntervalSeconds`: at least one pool for the default token, a tip height from the
  BCH servers, and, only while crossings are open, the route's own halt flags for BCH and its destination chains. A probe
  that throws counts as down. `GET /api/health` returns the last report; nothing is stored.
- The footer shows one line from that report ("Cauldron ok · Bitcoin Cash ok · THORChain ok"). The route is listed only
  while crossings are open.
- When the last check saw the route halted, `out` and `in` quote and plan endpoints answer 503 `route_paused`, and both
  cross-chain forms show "Paused by the route". Recording a source transaction already sent is never blocked. An unknown
  state (before the first check) counts as open; the route's own quote still refuses a halted chain.
- `cf-ipcountry` is read only when the reverse proxy saw a Cloudflare address (same rule as `cf-connecting-ip`). A country
  in `compliance.blockedCountries` gets 451 `restricted_region` on new crossings. Static pages, Swap and landing
  addresses are not gated.
- Alerts stay on the host (`deploy/uptime.sh`), not in the container.

## Consequences

A route halt or recovery shows within one interval without a deploy. Requests that reach the container without Cloudflare
are never region gated, which is acceptable because the public name only resolves through Cloudflare.
