# 0045: WalletConnect for EVM wallets (Send out and Bring in)

Date: 2026-11-17. Status: accepted.

## Context

Send out and Bring in reach EVM wallets through EIP-6963: a wallet extension in the same browser, or the browser
inside a wallet app. A user whose EVM wallet is an app on another phone, or on the same phone outside its browser,
had no way to connect it. PRD 4.14 names WalletConnect's official EIP-1193 provider, loaded only when a project id is
configured.

## Decision

- Package: `@walletconnect/ethereum-provider` at exactly **2.21.8**. Its `package.json` and the `LICENSE` file in
  the tarball are Apache-2.0. Every later release (from 2.21.9, published 2025-09-18) declares
  `SEE LICENSE IN LICENSE.md`, a vendor licence that is not OSI approved, so newer versions are not used. The
  licences of its installed dependency tree, read from each `package.json`, are MIT, Apache-2.0, ISC, BSD-2/3,
  0BSD and BlueOak-1.0.0. It speaks the same v2 relay protocol as current wallets (measured below).
- It is a dev dependency: Vite bundles it into its own chunk of the page; the server never imports it, so the
  runtime image does not carry it.
- Loaded on demand only. `config.evm.walletConnectProjectId` empty means no option on the page, no relay in the CSP
  and no request for the chunk. When set, the option appears beside the EIP-6963 wallets and the chunk is fetched
  when the user picks it (`web/src/evm/walletconnect.ts`, the only `import()` of the package; no static import
  anywhere in `web/src`, checked by `tests/walletconnect.test.ts`).
- Sampan draws the pairing QR code itself (`showQrModal: false`, byte-mode QR from `core/qr.ts`), with "Open in
  wallet app" (the `wc:` link) and "Copy link", in the same dialog frame as the BCH pairing. The vendor modal
  (`@reown/appkit/core`, imported by the provider only when its modal is on) is replaced at build time by a stub
  (`web/src/evm/no-appkit.ts`), so neither it nor its dependencies are in the bundle.
- Telemetry off (`telemetryEnabled: false`). Pairing uses only chains the route offers, with each chain's first RPC
  from config, so read calls go to RPCs the CSP already allows.
- CSP: `connect-src` gains the relay origin only (`config.evm.walletConnectRelay`). The provider also opens a
  WalletConnect Verify frame that attests the page's origin to the wallet, so the wallet can show that the pairing
  comes from the allowlisted domain. It cannot be turned off from the page, and blocking it leaves a CSP error in the
  console, so `frame-src` allows that one origin (`config.evm.walletConnectVerify`) when the option is on. No other
  frame is allowed; with the option off there is no `frame-src` and `default-src 'self'` applies.
- Under `SAMPAN_FAKE` the page loads an e2e stand-in (`web/src/evm/wcFake.ts`) that shows a `wc:` link and
  connects when the test approves it.

## Measured (2026-11-17, local built server against the real relay, project id from config)

Chromium desktop and WebKit iPhone 13 (320 px wide): picking WalletConnect in Bring in showed a `wc:...@2?relay-protocol=irn`
link in 2.3 s and 3.6 s. Origins contacted: the relay (WebSocket), the Verify frame, and the Ethereum RPC already in
config. No console errors before the screenshot was taken (WebKit's screenshot itself adds one style-src message, as
on every page). No horizontal overflow.

## Consequences

- The relay must accept the site's origin: the project's domain allowlist at the vendor is the operator's to keep.
- A pairing that is closed before the wallet approves is ignored if it settles later.
- Rollback: set `evm.walletConnectProjectId` to "" and rebuild; nothing is loaded and the CSP returns to before.
