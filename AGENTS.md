# Notes for agents

Notes for anyone (person or coding agent) working in this repository.

## Layout

Modules, data flow, trust boundaries and scaling are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

- `core/` pure TypeScript: pool math, transaction builders, the invariant checker. No I/O; `core/client/` holds the page flows (scan, swap) with the fetch function passed in.
- `contracts/` CashScript sources, compiled artifacts and their tests.
- `server/` Fastify API, Electrum and indexer clients, SQLite, the keyless finisher.
- `web/` Vite + React page. All user-facing text comes from `lang/`.
- `tools/` command-line helpers for measuring mainnet runs; `tools/test-wallet` is a headless WizardConnect wallet that signs only what `checkTransaction` and the test budget allow.
- `config/sampan.json` every value that may change (limits, servers, timings, flags). Code reads it; code does not hold it.
- `lang/<code>.json` UI text, one file per language listed in `config.i18n` (English, Malay, Indonesian, Filipino), same keys.
- `mcp/` Model Context Protocol server over stdio, a client of the public API; no keys, no signing.
- `scripts/` README block generators (`npm run bounty`, `crossings`, `route-facts`, `pitch` with `-- --write`), the public finisher, the gate.
- `docs/decisions/` short architecture decision records.

## Rules

- Everything tracked is in English. Other languages appear only in `lang/<code>.json` and the translated `README.ms.md`.
- The server never holds a private key. It builds unsigned transactions; the page checks each one before the wallet signs.
- Public numbers come only from `docs/MEASURED.md` or the live stats endpoint.
- Small modules (aim for 300 lines or fewer). Record a decision as an ADR when the plan leaves it open.
- Small commits, plain English messages, no history rewrites.

## Commands

Node 22 (`.nvmrc`), npm.

- `npm ci` install.
- `npm run dev` server on :8080 and Vite on :5173 (Vite proxies `/api`).
- `npm test` unit tests (vitest, no network).
- `npm run build` page into `web/dist`, server into `dist/server`.
- `npm run e2e` Playwright against the built server with `SAMPAN_FAKE=1` (Chromium desktop, WebKit iPhone 13). Build first.
- `npm run lint`, `npm run typecheck`.
- `bash scripts/gerbang-ujian.sh` everything above in order; this is the gate CI runs.

## Invariants checked by tests

- Every `lang/<code>.json` has the same keys and placeholders as `lang/en.json`.
- `config/sampan.json` passes `validateConfig` (`core/config.ts`); `/api/config` never exposes server-only sections.
- Every response has a strict CSP; HTML is `no-transform`; `noindex` follows `site.noindex`.
