# Architecture

Sampan is one Node 22 process (Fastify) that serves a Vite and React page and a JSON API. It builds unsigned
transactions; wallets sign. The decisions behind each part are in `docs/decisions/`.

## Modules

| Folder | What it holds | Input and output |
|---|---|---|
| `core/` | Pure TypeScript shared by page, server, MCP server and tools: pool math (`core/pools`), transaction builders (`core/tx`), the browser check (`core/check.ts`), the landing address (`core/landing.ts`), the cost card (`core/cost.ts`), config validation (`core/config.ts`) | No I/O; `core/client/` holds the page flows with the fetch function passed in |
| `contracts/` | The landing contract `contracts/landing.cash`, its compiled artifact and tests | Compiled with `cashc` |
| `server/` | API routes (`server/api`), Electrum client (`server/chain`), Cauldron indexer client (`server/indexer.ts`), the landing finisher (`server/landing`), Sampan Pay (`server/pay`), cross-chain routes (`server/routes`), SQLite store (`server/db.ts`) | Public Electrum servers, the Cauldron indexer, THORNode and the NEAR Intents 1Click API; one SQLite file |
| `web/` | The page: tabs, wallet pairing (`web/src/wallet`), EVM wallets (`web/src/evm`), status page, `/how`, `/faq`, `/demo` | Text from `lang/<code>.json`, values from `/api/config` |
| `mcp/` | A Model Context Protocol server over stdio, a client of the public API | No keys, no signing |
| `tools/` | Measuring scripts (`tools/measure`), the headless test wallet (`tools/test-wallet`), the synthetic probes (`tools/synthetic`), deck and video builders | Write rows to `docs/MEASURED.md` |
| `scripts/` | README block generators, the public finisher (`scripts/finisher-cli.ts`), `scripts/verify-landing.ts`, the gate `scripts/gerbang-ujian.sh` | Read config and `docs/MEASURED.md` |
| `config/` | `config/sampan.json`: limits, servers, timings, flags, assets marked live | Read by every part; validated at start |
| `deploy/` | `deploy/deploy.sh`, `deploy/compose.yaml`, the Traefik template, `deploy/synthetic.sh` | One container |

## Data flow

**Swap on BCH.**
1. The page pairs with the wallet over WizardConnect and receives extended public keys; it derives the addresses and the
   server scans them on Electrum.
2. The server reads the pools from the indexer, rebuilds each pool's locking bytecode to confirm it on chain, and builds an
   unsigned transaction.
3. `core/check.ts` in the browser compares that transaction with what the page showed. Only a transaction that passes goes
   to the wallet.
4. The wallet signs; the server broadcasts and waits until Electrum lists the new outputs.

**Landing address (Bring in, Sampan Pay).**
1. The server computes a P2SH address of `contracts/landing.cash` from the owner's address and a minimum rate; the page
   recomputes it from the same terms and refuses one that differs. The page offers a recovery card.
2. Any wallet pays BCH to the address.
3. The finisher (`server/landing/watcher.ts`, or `scripts/finisher-cli.ts` run by anyone from the card) converts through
   the pools when they meet the minimum, or gives the BCH back after `landing.returnAfterBlocks` blocks. Neither path needs a key.
4. For Sampan Pay, the server reads the conversion back from the chain and then sends a signed webhook.

**Crossing (Send out, Bring in on another chain).**
1. The server asks the route (THORChain THORNode, or 1Click) for a quote, and the cost card shows its fees.
2. Send out: the BCH wallet signs a swap to BCH and a deposit to the route's inbound address with the memo the quote gave.
   Bring in: the EVM wallet signs a deposit whose BCH leg pays a landing address, which then converts to PUSD.
3. The status page (`/c/:id`) follows each leg on its own chain until it arrives.

## Trust boundaries

- **Wallets hold the keys.** The server never holds a private key (`tests/client-swap.test.ts`, `contracts/landing.test.ts`).
  The production container has no key in its environment.
- **The server is not trusted by the page.** Every transaction it builds is checked in the browser before a wallet sees
  it; a landing address it returns is recomputed by the page and by the MCP server.
- **The contract limits the server.** A landing coin can only pay its owner: PUSD at or above the minimum rate, or the BCH
  back after the timeout. Anyone can run either path.
- **Outside services are read, not trusted.** Pools from the indexer are confirmed on chain; a crossing is marked arrived
  only from the destination chain; a route that halts a chain shows that network as paused.
- **Webhooks.** Sampan Pay sends webhooks only to https URLs whose every address is public, checked when the invoice is made and again before each delivery (`server/pay/ssrf.ts`).

## Scaling

What one process does today, and what would change with more use:

- **State.** One SQLite file holds landings, crossings and invoices. More traffic first means a larger volume and
  backups; moving to a server database touches `server/db.ts` and the Pay store only.
- **Chain reads.** Each watched landing address holds one Electrum subscription, and `landing.pollSeconds` adds a poll.
  Many open addresses would move the watcher to a separate worker process reading the same database, and add Electrum
  servers to `config/sampan.json`.
- **Quotes.** Pool and route quotes are fetched per request and limited per client IP (`rate.quotesPerMinute` in config). A short cache
  per pool snapshot would cut indexer calls under load.
- **No custody to scale.** Because the server holds no keys and the finisher can be run by anyone, a second instance or
  a third party can finish landings without sharing secrets.
- **Container limits.** The live container runs with 0.5 CPU and 256 MB (`deploy/compose.yaml`); these are the first
  values to raise.
