# Operations

How the public site is watched and what to do when a check fails. Draft: the Test wallet funds and Judging week sections are
added later.

## Probes

Two cron jobs on the host run `deploy/synthetic.sh`; the probes themselves are in `tools/synthetic/probes.ts`.
Every probe prints one JSON line `{probe, ok, ms, detail}`; the state file `deploy/.synthetic-state` (not tracked) keeps
failures in a row, the alerts sent today and the latest 48 runs.

| Probe | When | Passes when |
|---|---|---|
| `page` | hourly, minute 17 | `GET /` answers 200 with a Content-Security-Policy header, and every script and stylesheet it names answers 200 |
| `config` | hourly | `GET /api/config` answers JSON with the feature switches |
| `health` | hourly | `GET /api/health` reports the Cauldron indexer and the Bitcoin Cash servers up (and the route open, only while crossings are open) |
| `quote` | hourly | a swap quote for 0.001 BCH to the default token through the site's own API has a price |
| `landing` | hourly | the site opens a landing address for the test wallet's own address and the address recomputed from the returned card matches; nothing is paid, and the row is counted as test, never public |
| `indexer` | hourly | at least one configured Cauldron indexer returns one or more pools for the default token |
| `electrum` | hourly | at least one configured Electrum server returns a tip height; servers that did not answer are named in `detail` |
| `thornode` | hourly | at least one configured THORNode reports BCH and every destination chain not halted; fails only while crossings are open |
| `render` | 01:47 and 13:47 UTC | `e2e/front.spec.ts` passes against the public URL in Chromium desktop and WebKit iPhone 13 |

The probes read only. No probe sends a transaction or spends any funds.

## Alerts and actions

A probe that fails twice in a row sends one `warn`; the first pass after that sends one `info`. Each probe alerts at
most once per UTC day, and probes that go down in the same run share one message. The text of each alert is in
`lang/ms.json` and `lang/en.json` under `alerts.synthetic.*` and says what failed, why it matters and what to do.

| Probe | Usual cause | Action |
|---|---|---|
| `page`, `config` | container stopped or proxy route lost | check the container; restart it with the same image tag (`deploy/CURRENT_TAG`) |
| `health`, `indexer`, `electrum`, `thornode` | an outside provider is down | the page shows the status and pauses the flow that needs it; wait for the provider |
| `quote` | the indexer or the Electrum servers | read the `indexer` and `electrum` lines of the same run; if both pass, restart the container with the same tag |
| `landing` | the indexer (the rate comes from the pools) or the database volume | as for `quote`; if it persists, restart with the same tag |
| `render` | the page or one of its assets | restart with the same tag, then run `deploy/synthetic.sh render` again |

The container's uptime watch (`deploy/uptime.sh`, every five minutes) runs alongside and alerts on `/` and `/healthz`.

## Failover

Measured on 2026-11-16 with `tools/measure/failover.ts` (table: `docs/MEASURED.md`, section Failover; decision:
`docs/decisions/0026-failover-measured.md`).

| What fails | What the server does | What the page shows | Action |
|---|---|---|---|
| One Electrum server | moves to the next server in `electrum.servers`; a server that never answers costs one 10 s timeout once | nothing | none; if it stays down, remove it from config at the next allowed deploy |
| Every Electrum server | swaps, scans and landings answer `chain_unavailable` (503) after the timeouts | "Not answering right now: Bitcoin Cash" under the card and in the status line; Cauldron is not named | wait for the providers |
| The Cauldron indexer | swaps answer `pools_unavailable` (503) at once; wallet scans still work | "Not answering right now: Cauldron" | wait for the provider; there is one indexer in config |
| One THORNode | the next node in `thorchain.nodes` answers; a node that never answers costs `thorchain.timeoutMs` once | nothing | none |
| THORChain halts BCH or the destination chain | new crossings answer `route_paused` (503) | "Paused by the route" in the crossing tabs | wait for THORChain to reopen |

