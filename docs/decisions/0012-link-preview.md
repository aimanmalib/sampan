# 0012: Link preview tags and picture

Status: accepted, 2026-11-15

## Context
Links to the site are shared in chats and posts. Without Open Graph and Twitter tags the preview has no picture and
no description, and the description must match the flows that are open (see 0009).

## Decision
- `web/index.html` carries `og:*` and `twitter:*` tags as placeholders. At build time `core/page-meta.ts` fills them:
  title from `lang/en.json`, description from the same flow-aware key as the description tag, origin from
  `config/sampan.json` `site.url`, picture path from `site.ogImage`.
- The picture is a PNG committed under `web/public`, drawn by `npm run og-image` (`tools/og-image.tsx`) from the same
  sampan drawing the page shows (`web/src/SceneArt.tsx`), 1200 x 630, refused above 300 KB.
- Width and height are read from the PNG header at build time, and the URL carries `?v=` with a short content hash, so
  a new picture is not hidden by a cached old one.
- No `robots.txt` rule blocks preview bots; `site.noindex` only sends `X-Robots-Tag`.

## Consequences
Changing the headline, colours or drawing means running `npm run og-image` and committing the new PNG.
Rollback: remove the tags from `web/index.html`; nothing else reads them.
