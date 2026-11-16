# 0026 Provider failover, measured

Date: 2026-11-16

## Context

Sampan depends on three outside providers: the Bitcoin Cash Electrum servers (four in config), the Cauldron indexer
(one in config) and, while crossings are open, THORNode (one in config). The clients already move to the next
configured server when one fails, but nothing measured how long that takes or what the page says when a provider
is gone completely.

## Decision

- `tools/measure/failover.ts` runs the built server on the host against the real providers, with the config patched
  so that one provider is replaced by an address that refuses the connection or never answers. It reads only: no
  transaction is built or sent. The results are the Failover table in `docs/MEASURED.md`, written again as a whole on
  every run.
- One fix came out of the measurement. The pools are checked on the Bitcoin Cash servers, so with every Electrum
  server down the health report also called Cauldron "not answering". The pools probe now reports Cauldron as
  unknown when it fails because the Bitcoin Cash servers are unavailable, and the page names only Bitcoin Cash then.
- No second Cauldron indexer is added. A second one would be accepted only from Cauldron's own documentation and
  after its pools were compared with the first (same owner hash per pool); neither was available on 2026-11-16. With
  the indexer down, the page names Cauldron and the swap answers `pools_unavailable` at once (Failover case c).
- No circuit breaker for a total Electrum outage. Each request then waits for the silent server's timeout (about
  10 s per request in case b), which stays well inside the page's 45 s request timeout and ends in the provider note.
  Adding one would mean more state for a case the health line already explains.

## Consequences

- A first Electrum server or THORNode that never answers delays the first health report by its timeout (Electrum
  10 s, THORNode `thorchain.timeoutMs`); requests after that are served by the next server at normal speed.
- During the measurement THORChain reported Base trading halted (`HALTBASETRADING`), so the route rows show the
  route as paused: the second THORNode answered, and the server refused new crossings as designed.
- Run the tool again after changing `electrum.servers`, `cauldron.indexers` or `thorchain.nodes`.
