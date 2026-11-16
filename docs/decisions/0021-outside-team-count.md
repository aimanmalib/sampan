# 0021: Counting swaps, landings and crossings by wallets outside the team

Date: 2026-11-16

## Context

The front page Measured line counted only landings and crossings by wallets outside the team. Swaps through the pool are
the flow most people try first, and they were not counted at all, so the public part of the line stayed at zero.

## Decision

- `/api/stats` returns `swaps` next to `completed` for `all`, `test` and `public`. A swap counts once the server has
  broadcast it and recorded its txid (`status = 'broadcast'`, `txid` set). A built, stale or failed swap does not count.
- The front page shows "Swaps, landings and crossings by wallets outside the team: n" only when `public.swaps +
  public.completed` is at least 1. At zero the part is left out, never shown as 0.
- A row is "outside the team" only when none of its wallet's locking scripts belong to a team address. The team list is
  `ops.testAddresses` in the config plus `SAMPAN_TEST_ADDRESSES` on the host. On the host that list holds every used
  receive and change address of the test wallet (scanned over Electrum to the gap limit) and the owner's phone wallets.
  Rows already stored are moved to `test` when the server starts.
- Phone wallets pay from a new address each time, so an address list alone misses them (the first deploy of this change
  counted five of the team's own swaps as outside the team until their addresses were listed). The server build also
  takes every transaction id in the Runs table of `docs/MEASURED.md`, and a row with one of those ids is moved to `test`
  at start, whatever its address. Runs only ever records the team's own measurements.

## Consequences

A team run counts as public from the moment it is made until its txid is in MEASURED.md and the server is rebuilt, or its
address is on the host list and the server restarts. Check `/api/stats` `public` against Runs before quoting it.
