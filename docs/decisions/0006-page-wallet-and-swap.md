# 0006 Page: wallet connection, swap tab and test wallet

Date: 2026-11-14. Status: accepted.

## Context

The page connects a BCH wallet with WizardConnect, finds its coins, and runs a swap the server builds. The browser must refuse any
transaction that does not match what it showed before a wallet sees it. Mainnet runs need a wallet that signs without a person, and
the e2e run needs a wallet that works offline.

## Decisions

- **One session interface** (`core/client/session.ts`): public key per path and index, and `sign`. Two carriers: WizardConnect
  (`web/src/wallet/wizard.ts`, keys from the shared xpubs) and the fake wallet of `SAMPAN_FAKE=1` (public BIP39 test phrase,
  loaded only when the server reports fake mode). The scan, swap and check code is the same for both and lives in `core/client/`
  so it runs under vitest.
- **The browser writes the expectation.** From `/api/swap/build` only the pool owner hashes and input paths are used. The user's
  own locking bytecodes come from addresses derived in the browser, the amounts and minimum from what the page displayed, and the
  fee cap from config. Each input path must name the address whose coin that input spends. A server that adds a stranger to the
  "user" set or lowers the minimum is refused (tests `tests/client-swap.test.ts`).
- **Sign request shape.** The transaction is sent as a hex string with `broadcast: false`; source outputs use the relay format of
  `@wizardconnect/core/hdwalletv1-serialize` (hex bytes, `<bigint: Xn>` amounts), because the relay carries plain JSON. Whether
  Paytaca and Cashonize accept this exact shape is measured with real wallets in the next step and recorded then.
- **Own pairing dialog.** The library's `AlphanumericQRCode` is used inside a Sampan dialog instead of `WizardConnectQRDialog`:
  the library dialog uses a blurred backdrop (a WebKit crash risk on this site), a small close button and English-only labels.
  The dialog has translated text, a 44 px close button, Escape to close and a "Copy link" button for a wallet on the same phone.
- **CSP.** `script-src` adds `'wasm-unsafe-eval'` because libauth compiles WebAssembly (secp256k1, hashes) in the browser;
  JavaScript eval stays off. `connect-src` adds the WizardConnect relays from `connect.relayUrls`.
- **Flag until measured.** `features.swap` is `false` in the shipped config; the tab shows "Not open yet" until three mainnet swaps
  are recorded. `SAMPAN_CONFIG_PATCH` (JSON merged over the file, unknown keys refused, validated) lets the e2e server switch the
  flow on and lift rate limits, since every browser in the run shares one IP.
- **Status page.** `GET /api/crossings/:id` returns kind, status, asset, amount and txid only (no addresses, no payloads).
- **Headless test wallet** (`tools/test-wallet/`): a WizardConnect wallet adapter that signs only when the request passes
  `checkTransaction` rebuilt from the caller's intent file (pool inputs are accepted only when their unlocking bytecode is the exact
  v0 exchange unlocking of the pool they spend), the per-transaction and per-day USD limits of `state/budget.json` hold, and then
  appends to `state/test-ledger.jsonl`. It signs with SIGHASH_ALL | FORKID.
- **Licence.** The `@wizardconnect/*` packages do not declare a licence field in `package.json`; their sources carry the LGPL 3.0
  or later header. They are used unmodified as dependencies.

## Undo

Turning `features.swap` off hides the tab. The library dialog can replace the own dialog in one file if it gains a plain backdrop.
