# Notes for agents

Notes for anyone (person or coding agent) working in this repository.

## Layout (planned)

- `core/` pure TypeScript: pool math, transaction builders, the invariant checker. No I/O.
- `contracts/` CashScript sources, compiled artifacts and their tests.
- `server/` Fastify API, Electrum and indexer clients, SQLite, the keyless finisher.
- `web/` Vite + React page. All user-facing text comes from `lang/`.
- `tools/` command-line helpers for measuring mainnet runs.
- `config/sampan.json` every value that may change (limits, servers, timings, flags). Code reads it; code does not hold it.
- `lang/en.json`, `lang/ms.json` UI text, English and Malay, same keys.
- `docs/decisions/` short architecture decision records.

## Rules

- Everything tracked is in English. Malay appears only in `lang/ms.json`.
- The server never holds a private key. It builds unsigned transactions; the page checks each one before the wallet signs.
- Public numbers come only from `docs/MEASURED.md` or the live stats endpoint.
- Small modules (aim for 300 lines or fewer). Record a decision as an ADR when the plan leaves it open.
- Small commits, plain English messages, no history rewrites.

## Commands

Added with the code scaffold.
