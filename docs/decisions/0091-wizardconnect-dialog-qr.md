# 0091: WizardConnect pairing dialog, measured

Status: accepted, 2026-11-21

## Context

The pairing dialog already had a QR code that copies its link when tapped, a "Copy link" button and the hat icon on
every button that starts a pairing. None of the layout was measured, and the dialog itself carried no hat.

## Decision

- A new spec (`e2e/qr-wizard.spec.ts`, Chromium desktop and WebKit iPhone 13, also at 320 px) checks: the hat leads the
  dialog title and is hidden from screen readers, so the title's name is unchanged; "Copy link" sits straight under
  the code (at most 24 px below it, on the same centre line, the next stop for Tab); the drawn code is whole inside
  its frame and centred in the dialog; the code and the button copy the same `wiz` link, with visible feedback and a
  polite live region; nothing spills sideways.
- The spec found one gap: at 320 px the code sat 3 px right of the centre line, because the QR button's grid
  track could not shrink below its content. The QR button and its wrapper now use a `minmax(0, 1fr)` track and
  `min-width: 0` (shared by every copyable QR code on the site).
- The hat in the dialog reuses the drawing in `WizardHat.tsx` (drawn for Sampan) with its own class; `Dialog` takes an
  optional icon, which the WalletConnect (EVM) dialog does not pass.
- The WizardConnect React package already draws its own hat logo over the middle of the code, with error correction
  level H. The spec reads the code's pixels once that logo is on and decodes them with `jsqr` (Apache-2.0, a dev
  dependency only): the result is the copied link in QR alphanumeric form (percent-encoded, capitals). Sampan adds no
  logo of its own to the code, so no new flag (`ui.qrBrand`) was needed.

## Consequences

To undo, drop the `icon` prop in `ConnectDialog.tsx`; the layout fix stands on its own.
