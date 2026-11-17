# 0046: QR code first on the landing card, QR codes that copy, hat icon on WizardConnect buttons

Date: 2026-11-17. Status: accepted.

## Context

Organiser feedback in the event chat, 17 Nov, on payment pages in general: show the QR code at once so it is easy to
scan, keep the WizardConnect button beside it, let a click on the QR code copy the link, and do not open a page with
sound. On Sampan's Bring in card the QR code appeared only after a second button, "Get my landing address", even when
the page already knew the owner (a connected wallet).

## Decision

- `config.ui.qrAutoOpen` (boolean, shipped `true`, sent to the page in `/api/config`). When it is on, the landing card
  opens the address and shows its QR code by itself as soon as the owner is known: a connected wallet, or a valid
  address pasted, left (blur) or confirmed with Enter. Not on every key, so a half-typed address never asks the
  server for anything. It opens once per (owner, token); a failure shows the existing error and leaves the
  "Get my landing address" button as the manual path, and "Make a new address" does not reopen the same owner.
- Until the owner is known the card shows an empty, dashed QR frame with "Your QR code appears here as soon as we
  know where the PUSD goes". It sits under the one primary button, so on a phone it never pushes that button off
  the first screen (`e2e/first-screen.spec.ts`).
- `ui.qrAutoOpen: false` gives the earlier behaviour (one flag, no build change needed beyond the config).
- QR codes are buttons that copy the link they hold (`web/src/QrCopy.tsx`): the WizardConnect pairing QR copies the
  pairing link, the landing and Sampan Pay invoice QR codes copy the same BIP21 link they encode. The result is said
  in a live region; the existing "Copy link" / "Copy address" buttons stay. No clipboard API: nothing happens.
- Every button that starts a WizardConnect pairing shows a wizard's hat drawn for Sampan
  (`web/src/wallet/WizardHat.tsx`, `currentColor`, hidden from screen readers so the label stays the button's name).
  No logo, file or code is taken from the WizardConnect packages or any other project.
- No sound anywhere: no audio element, `AudioContext` or media `play()`; `e2e/qr-first.spec.ts` counts attempts and
  expects zero.
- Tab order and the judge path are unchanged. The measuring tool for landings (`tools/measure/land.ts`) reads the
  flag from `/api/config` and presses "Get my landing address" only when the flag is off, because with the flag on
  the primary button is already "Pay from connected wallet".

## Consequences

- One fewer click between a connected wallet and a scannable QR code.
- A landing address is opened (one `POST /api/land/open`) for a pasted owner without a click; the server's existing
  rate limit applies as before.
- Rollback: set `ui.qrAutoOpen` to `false` and redeploy.
