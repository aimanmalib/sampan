# 0020 Hourly synthetic monitor from the host

Date: 2026-11-16. Status: accepted.

## Context

The uptime watch only checks that `/` and `/healthz` answer. A judge can still meet a page whose script fails to load,
a quote that never comes back or a landing address that cannot be opened, while every outside provider the site
depends on (Cauldron indexer, Electrum servers, THORNode) can go down on its own.

## Decision

- A host cron job runs `deploy/synthetic.sh` every hour; it runs `tools/synthetic/probe.ts`, which checks the public
  site the way a visitor would (`page`, `config`, `health`, `quote`, `landing`) and every configured provider directly
  (`indexer`, `electrum`, `thornode`). A second job runs the front-page browser test twice a day (`render`).
- A provider probe fails only when every configured provider of that kind fails; one server down is named in the
  detail. The THORNode probe fails only while crossings are open.
- Two failures in a row of one probe raise one alert, recovery sends one info line, each probe alerts at most once per
  UTC day, and probes that go down in the same run share one message, so one outage is one message.
- The landing probe opens an address for the test wallet's own address from `ops.testAddresses`, so the server counts
  the row as test; it pays nothing.
- The alert rule is a pure function (`tools/synthetic/alerts.ts`) tested on its own; the shell only sends what it prints.

## Alternatives

Uptime Kuma and basecamp/upright (both MIT) were considered. They are not used because the probes need the site's own
API (quote, landing card) and the host already has cron and an alert channel; another service would be one more thing
that can fail during judging.

## Undo

Remove the two `SAMPAN-SINTETIK` lines from the host crontab. Nothing in the site depends on the monitor.
