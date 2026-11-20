# 0084: Demo videos on a media host name

Date: 2026-11-20

## Context

The site's host name goes through a CDN proxy, and the terms of that free CDN plan do not cover serving video files.
The demo video of ADR 0082 was in `web/public/demo/`, so the build copied it into the page files and the site host
served it. There is now also a one minute cut (same clips, English subtitles burned in) that should be the first
video a visitor sees.

## Decision

- Video files live in `media/` (tracked), not under `web/`: `media/demo/sampan-demo-60.mp4` (one minute cut) and
  `media/demo/sampan-demo.mp4` (the full walkthrough the chapters belong to). The image copies `media/` beside the
  server.
- A second host name, `config.media.host`, points at the same server without the CDN proxy. The server answers
  `/media/*` only when the request's host is that name; any other host, the site's own included, gets the 404 page.
  Range requests answer 206 (`@fastify/static`), with `Cache-Control` from `config.media.cacheControl`.
- The proxy route for the media name is its own pair of routers (`sampan-media`, `sampan-media-http` in
  `deploy/traefik.yaml.tmpl`) with its own certificate, for `/media/` only and without compression. The site's
  router stays `Host(site)` alone, so a problem with the media name never touches the site's certificate.
  `deploy/deploy.sh` needs `MEDIA_DOMAIN` in `deploy/hos.env`.
- `demo.video` (one minute cut) and `demo.videoLong` (full walkthrough) are `https://<media.host>/media/….mp4`;
  config validation refuses anything else. CSP `media-src` adds that one origin.
- The poster and the WebVTT tracks stay on the site host (`demo.poster`, `demo.tracks`): a track must come from the
  page's own origin (or need CORS), and they are small text files.
- `/demo` shows the one minute cut first, then the full walkthrough with its tracks and chapter buttons. The one
  minute cut has no tracks, since its English subtitles are in the picture.

## Way back

`features.demo: false` hides the page. Pointing `demo.video`/`demo.videoLong` back at the site host is refused by the
config check on purpose; the files would have to move back under `web/public/`.
