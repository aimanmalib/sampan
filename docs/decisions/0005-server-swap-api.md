# 0005 Server: Electrum, pool discovery, swap API and storage

Date: 2026-11-14. Status: accepted.

## Context

The page needs coins from the user's wallet, a swap quote, an unsigned swap transaction it can check before the wallet sees it, and a
way to broadcast the signed result. The server holds no keys.

## Decisions

- **Electrum.** `@electrum-cash/network` over WebSocket with failover through `electrum.servers`: a failed request moves to the next
  server and is retried there once per server. A node rejection of a broadcast is returned as is (not retried elsewhere). Servers
  checked live on 2026-11-14 (Fulcrum 2.1.x, same tip height 977359): `bch.loping.net`, `bch.imaginary.cash`, `fulcrum.greyh.at`,
  `fulcrum.jettscythe.xyz` (all `wss`, port 50004). `electroncash.de:60002` timed out and was removed. `listunspent` on these
  servers includes `token_data`.
- **Pool discovery.** The Cauldron indexer is used only to learn which pools exist (cache `cauldron.cacheSeconds`). A pool is kept
  once its owner hash, rebuilt with the v0 template, gives a locking bytecode that holds a pool UTXO of that token on chain (checked
  once per pool UTXO). Before every build, each pool is read again from Electrum and the live UTXO at its lock is used; one pool per
  owner hash.
- **Swap build.** `selectTrade` with the user's amount as the supply, then `buildSwapTx`, then the libauth VM on the pool inputs.
  A VM failure retries with fresh pools up to `cauldron.buildAttempts`. A fresh result below the quoted minimum stops with
  `price_moved`. Bought tokens go only to a token-aware address of the same wallet. Coins carrying an NFT or another token are never
  spent. The response carries the transaction, source outputs, input paths and the expectation the page compares against.
- **Broadcast.** Only for a crossing built here: the signed transaction must spend the same outpoints in the same order and pass the
  VM against the recorded source outputs. A spent pool answers `409 stale_inputs`; the page rebuilds the same crossing, at most
  `cauldron.buildAttempts` times.
- **Wallet scan.** The page sends address batches per path (`receive`, `change`, `defi`) with their start index; the server answers
  history and coins and whether `wallet.gapLimit` unused addresses follow the last used one. Results stay in memory for
  `wallet.scanCacheSeconds` and are dropped for addresses a broadcast touched.
- **Storage.** Node's built-in `node:sqlite` (one file on the volume, no native build step, no ORM). Crossings store public
  addresses, amounts, txids and status; raw quote payloads are cleared after `ops.quotePayloadHours`. `origin` is `test` when an
  address of the request is in `ops.testAddresses`. The bundler keeps the `node:` prefix (`removeNodeProtocol: false`) because
  `node:sqlite` has no bare alias; the container starts Node with the experimental warning silenced.
- **Rate limits.** In-memory fixed windows per caller. X-Forwarded-For is read only when the socket peer is the reverse proxy
  (`SAMPAN_TRUSTED_PROXY`, resolved by name); `cf-connecting-ip` is believed only when that proxy saw an address inside
  `rate.cloudflareCidrs` (Cloudflare's published ranges).
- **Fake network.** `SAMPAN_FAKE=1` serves the captured pool fixture from an in-memory chain that applies broadcasts, and funds the
  first address of a wallet's first scan, so browser tests can run a whole swap offline.

## Consequences

New config keys: `cauldron.cacheSeconds`, `cauldron.buildAttempts`, `wallet.*`, `fees.capSats`, `rate.cloudflareCidrs`,
`ops.testAddresses`, `ops.quotePayloadHours`. Rollback: the endpoints are additive; removing the three route registrations in
`server/app.ts` returns the server to the static page and config only.
