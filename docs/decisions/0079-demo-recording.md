# 0079: Recording the demo video from real pages

Date: 2026-11-20

## Context

The demo video has to show the product doing real mainnet work, not a mockup. A crossing takes minutes, so the
edit cuts the waits, and a viewer needs a way to see that the cut happened.

## Decision

- `tools/video/record.ts` records raw clips with Playwright's `recordVideo`: Chromium at 1920x1080 and WebKit on an
  iPhone 13 profile for the phone shots. Each scene is its own clip, `<scene>-<engine>.webm`.
- A small clock in the corner of every clip shows the machine's real UTC time. The recording tool injects it.
  The site never ships it.
- The front page, the proof table on `/how`, a swap and a landing are recorded on the live site. The swap is signed
  by the headless test wallet through the page's own WizardConnect link. The landing is paid with a plain BCH payment
  from the test wallet.
- The Bring in scene drives the same page served by the built server of the recorded commit on the recording host.
  The crossing, THORChain and both chains are mainnet. The asset being recorded is switched on for that server only,
  because the live site opens an asset for Bring in only after measured runs of that asset. The EVM side is the
  test key behind an EIP-6963 stand-in. The page sends requests to the recording process, which signs them. The key
  never enters the page.
- Every paid scene spends from the test wallets inside `state/budget.json`. With `--write` it adds its row to the
  Runs table of `docs/MEASURED.md`. `state/video/shots.json` lists each clip's UTC start and end, marks, and the
  transaction ids on screen, and the tool reports any id that is missing from `docs/MEASURED.md`.
- The landing scene ends when the page's ferry reports `data-arrive="done"`, not after a fixed wait.

## Consequences

- The scene list and storyboard can change without recording everything again, because each scene is its own clip.
- The video can only show what the test wallets can pay for within the daily limit.
- Rollback: the tool has no effect on the site. Deleting `tools/video/` changes nothing that is served.
