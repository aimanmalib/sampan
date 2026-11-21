# 0089. The deck as full-screen slides at /slides

Date: 2026-11-21

## Context

The event deck is a PDF printed from `tools/deck/content.ts` (ADR 0070). A PDF opens in a viewer that varies by
browser and phone and cannot play the demo video. The plan asks for the same deck as a page: full screen, arrow keys,
swipe, `#n` for slide n, a Full screen button, and the "Try it in a minute" slide carrying the demo video.

## Decision

- `/slides` renders the slides from the same `slides()` list the PDF prints, with the English pitch counted from
  `docs/MEASURED.md` as slide 1 of the PDF is. One source for the text; the slide text stays English, the event's language. The
  controls (labels, position, PDF link, Full screen) are lang keys `slides.*` in every page language.
- One layout file, `tools/deck/deck.css`, for both. Every rule sits under `.deck`, so the page's own styles are not
  touched; the PDF page adds only its page box. A slide is drawn at 1280 x 720 and scaled with `transform` to the
  largest size that fits above the control bar, so the slide never scrolls or overflows, upright or sideways.
- Moves: arrow keys, Page Up/Down, Home/End, the two buttons, a sideways swipe (`ui.slideSwipePx`, pointer events,
  `touch-action: pan-y pinch-zoom`), and the address hash `#n`, which follows each move with `history.replaceState`.
  Full screen is offered only where `document.fullscreenEnabled` is true (iPhone Safari has no element full screen).
- The page loads nothing from another origin, so no template art is fetched from an outside URL: the slides keep the
  template's order and titles and wear the shipped theme's tokens and self-hosted fonts, as the PDF does.
- "Try it in a minute" shows the poster of the one minute demo with a play button while `features.demo` is on, and the
  video element is created only on that press: WebKit fetches the start of a video even with `preload="none"`, which
  would ask the media host before anyone chose to watch. With `features.demo` off the poster, a frame of the live site,
  is shown alone.
- The last slide and the control bar link the PDF (`banner.deckPdfUrl`), since `banner.deckUrl` moves to `/slides`.
- `/slides` exists only with `features.slides`; while it is off the server answers the 404 page. With it on,
  `banner.deckUrl` is `/slides`.
- The page script is a separate chunk loaded only on `/slides`; the front page does not grow.

## Way back

`features.slides` false and `banner.deckUrl` back to the PDF path (config only, then deploy).
