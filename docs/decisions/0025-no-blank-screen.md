# 0025 No blank screen when part of Sampan fails

Date: 2026-11-16

## Context

A single-page app shows a white page when its script fails to load or a component throws, and a raw message when
the server or a provider fails. Visitors, including judges opening the page days after a deploy, then cannot tell
whether Sampan is broken, a provider is down, or their own connection failed.

## Decision

- `web/src/ErrorBoundary.tsx` wraps the whole app and, separately, the body of every tab. A tab that throws
  shows a short card (`error.title`, `error.body`, a reload button) in its place; the headline, picture and other
  tabs stay. The banner has its own boundary.
- A script that fails to load (a tab left open across a deploy) reloads the page once per tab session, guarded by a
  `sessionStorage` flag (`web/src/errors/reload-once.ts`), from Vite's `vite:preloadError` event or a boundary.
  A second failure shows the card instead of looping.
- Under the action card, `ProviderNote` names the provider the last `/api/health` check saw not answering
  (Cauldron, Bitcoin Cash, the route), so a failed step comes with its reason. A halted route keeps its own panel.
- If `/api/config` cannot be read, the front page says the server is not answering (`error.server`).
  API requests from the page give up after `ops.requestTimeoutSeconds` and report the same way as offline.
- `index.html` carries the headline and a one-line loading text inside `#root`; React replaces it on mount,
  so it stays readable if the bundle never runs. No inline script.
- Server: unhandled 5xx become `{ "error": "server_error" }` under `/api/` (no internal message) and a static HTML
  page elsewhere, with the text of every language from `lang/*.json` and the colour tokens of the built stylesheet.
  Its one inline style is allowed by a sha256 hash in that response's CSP only. A missing file outside `/api/`
  gets the same page as a 404. 4xx answers are unchanged.
- `SAMPAN_FAKE_OUTAGE=indexer|electrum|api|chunk|render` (fake network only; unknown values refuse to start)
  makes one part fail on purpose. `e2e/outage.spec.ts` runs each mode in Chromium and WebKit on an iPhone 13.

## Consequences

The page always has a headline and a sentence that says what is wrong. The error page and boundary text live in the
lang files like every other text; a new language gets them through the same key-parity test.
