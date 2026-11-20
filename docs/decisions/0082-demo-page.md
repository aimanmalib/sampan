# 0082: The /demo page

Date: 2026-11-20

## Context

The cut demo video (ADR 0081) should be watchable on the site itself, and every transaction it shows should be one
click away, so a viewer can check that what the video shows really happened on mainnet.

## Decision

- `/demo` shows the video in the browser's own `<video>` player (no third-party player), served from this site:
  `web/public/demo/sampan-demo.mp4`, its poster and one WebVTT track per page language. CSP adds
  `media-src 'self'`. The page and its links (banner, footer, `/how`) exist only while `features.demo` is on; while
  it is off the server answers `/demo` with the 404 page.
- The web file is a second output of the same edit (`tools/video/edit.sh --web-out`): the same picture, scene titles
  and end card, but no spoken subtitles burned in. The full cut for upload elsewhere keeps its burned English
  subtitles; on the page they would sit under the player controls and stack with the page's own track (a Malay track
  over burned English, or English twice). The edit plan records `burnedSubtitles.web: false`, `demo-files.ts` refuses
  a plan without it, writes `burnedSubtitles: false` into the chapters file, and `core/demo.ts` refuses a chapters
  file without it. The track of the page language is the default one. `demo-files.ts` also refuses a file over 25 MB,
  in other codecs, or without the index at the front (`faststart`).
- `tools/video/demo-files.ts` writes `docs/demo/chapters.json` from the edit plan, `state/video/shots.json` and
  `docs/MEASURED.md`. A chapter is a scene of the cut that shows at least one transaction id held by an ok Runs row;
  ids that only a fail row holds (a dropped broadcast) are left out. Scenes without such an id (the opening and the
  end card) have no chapter. An id is listed only by the first chapter that shows it: the phone view of the proof
  table repeats the proof chapter's ids, so it is not a chapter of its own. A chapter links the status page of its crossing only when the shot ran on the live site.
  `core/demo.ts` checks the file (start times rising, every id in an ok row, at least four chapters) in the tests.
- Chapter titles and subtitle text are in `lang/<code>.json` (`demo.ch.*`, `demo.sub.*`). The English track is the
  edit's own, timed by the narration's alignment. Other languages spread their sentences over the same narration span
  by share of length (`tools/video/demo-subs.ts`); a test checks the tracked files are what it writes.
- A chapter lists up to `demo.txidsShown` ids, then links the proof table on `/how` for the rest.
- A chapter button moves the video to the chapter's start and plays it from there, only on that click. Nothing plays
  before the visitor asks.
- `demo.youtubeUrl` stays empty; only the owner fills it after uploading the video.

## Way back

`features.demo: false` hides the page and its links without a rebuild of the video files.
