# 0055: Self-hosted fonts, and the WebKit CSP message that only screenshots cause

Date: 2026-11-18. Status: accepted.

## Context

The theme tokens in `web/src/styles.css` name Fraunces, IBM Plex Sans and IBM Plex Mono, but no `@font-face`
existed, so no font was ever loaded: browsers fell back to Georgia or a system serif and the system sans. Measured
on the live site on 2026-11-18 (`/` in every language and `/how`, Chromium desktop 1440x900 and WebKit iPhone 13):
no font request, `document.fonts` with no loaded face.

The same run listened to the console twice per page, once without and once with `page.screenshot()`:

- Chromium: no Content Security Policy message on any page.
- WebKit, before any screenshot: none.
- WebKit, right after `page.screenshot()`: one "Refused to apply a stylesheet because its hash, its nonce, or
  'unsafe-inline' does not appear in the style-src directive" per screenshot, on every page.

The page has no inline style and no style element of its own (no `style=` attribute, `<style>`, `insertRule` or
constructed stylesheet in `web/`). The stylesheet WebKit refuses is the one Playwright applies while it captures; the
refusal appears with `caret: 'initial'` as well, so it is not only the caret rule. A visitor never takes a Playwright
screenshot, so this is not a visitor error, and the policy stays as it is.

## Decision

- Fonts are served from the site itself. The files are copied from the npm packages
  `@fontsource-variable/fraunces` 5.3.0, `@fontsource-variable/ibm-plex-sans` 5.3.0 and `@fontsource/ibm-plex-mono`
  5.3.0 (fonts under the SIL Open Font License 1.1; the license texts sit beside the files) into `web/src/fonts/`.
  They are not imported from `node_modules`, and no package is added.
- Six woff2 files: Fraunces (variable weight 100 to 900), IBM Plex Sans (variable weight 100 to 700) and IBM Plex
  Mono 400, each in a Latin and a Latin Extended subset split by `unicode-range`. English, Malay, Indonesian and
  Filipino text needs only the Latin file, so a page fetches one file per family it uses.
- `web/src/fonts/fonts.css` holds the `@font-face` rules with `font-display: swap`, under the family names the tokens
  already use, so no token changed. It is imported from `web/src/main.tsx`; Vite gives each file a hashed name,
  which matters because the CDN in front of the site overrides cache headers for static files.
- The policy is unchanged: `font-src 'self'`, `style-src 'self'`, no `'unsafe-inline'` anywhere.
- `e2e/fonts-csp.spec.ts`, in Chromium desktop and WebKit iPhone 13, checks that the two text families load, every
  font request is a same-origin woff2, the first screen fetches at most four font files, and that `/`, `/how` and a
  status page with a fixed answer produce no "Refused to" console message and no `securitypolicyviolation` event.
  It takes no screenshot, for the reason above.

## Rollback

Remove the `fonts.css` import from `web/src/main.tsx` and rebuild: the pages fall back to the system fonts the
tokens list after the first family.
