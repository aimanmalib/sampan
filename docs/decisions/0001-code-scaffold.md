# 0001 Code scaffold choices

Date: 2026-11-14. Status: accepted.

## Context

The plan fixes the stack (Node 22, strict TypeScript, npm, Fastify 5, Vite + React, plain CSS, vitest, Playwright) and the folder
layout. A few details were left open.

## Decisions

- **One package, one `tsconfig.json` for Node code and one `tsconfig.web.json` for the page.** `core/` is type-checked by both, so a
  browser-only or Node-only API used in `core/` fails the check.
- **Config is validated at start.** `core/config.ts` holds the type of `config/sampan.json` and `validateConfig`; the server refuses to
  start with a bad file and lists every problem. `/api/config` returns only the part the page needs (`publicConfig`).
- **`oneClick.baseUrl` ships empty.** The NEAR Intents route is not active; the validator requires a URL before `route.active` can be
  `near-intents`, so the route cannot be switched on by accident.
- **`banner.note` is a flag, not text.** The note's words live in `lang/`; the config only decides whether it shows. `banner.repoUrl`
  and `banner.deckUrl` stay empty until they lead somewhere a visitor can open, so the page never shows a dead link.
- **Electrum servers in the config are candidates.** They are checked live when the Electrum client is built and the measured list
  is recorded in a later decision.
- **Static HTML carries the event name and banner note.** `web/index.html` has the banner in plain HTML; a small Vite plugin fills
  its text from `lang/en.json`, so readers without JavaScript see the same words. React then renders the banner with the chosen
  language.
- **Headers.** Every response gets a CSP with `default-src 'self'` and no inline scripts or styles, `X-Robots-Tag: noindex` while
  `site.noindex` is true, and HTML gets `Cache-Control: no-cache, no-transform`. Hashed assets are cached for a year.
- **`SAMPAN_FAKE=1`** marks fixture mode; providers added later read it. The gate (`scripts/gerbang-ujian.sh`) runs lint, types, unit
  tests, the build and Playwright on Chromium desktop and WebKit iPhone 13 with no external network.

## Undo

Each item is local to one file (`core/config.ts`, `server/security.ts`, `vite.config.ts`, `scripts/gerbang-ujian.sh`).
