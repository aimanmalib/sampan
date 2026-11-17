# 0049: 1Click server module

Date: 2026-11-17. Status: accepted. Follows ADR 0048 (the pre-check). No deploy; `features.oneClick` stays false.

## Context

ADR 0048 chose 1Click (NEAR Intents) as a second route next to THORChain, called from the server only, with plain
`fetch` and types from the official OpenAPI. This record covers the server module and its config. The route row in
"Choose a route", the terms text and the mainnet runs come in later slices.

## Decision

- Modules: `server/routes/oneclick-api.ts` (client for `POST /v0/quote`, `POST /v0/deposit/submit`,
  `GET /v0/status`) and `server/routes/oneclick.ts` (the `Route` interface, like `thorchain.ts`).
  `server/routes/index.ts` builds the active route (THORChain) and, while `features.oneClick` is true, the 1Click
  route next to it. `route.active` stays `thorchain`. Asset ids come from config (read once from `GET /v0/tokens`
  in ADR 0048), so the server does not call `/v0/tokens`.
- Route id: the existing `near-intents` id (already the key of `limits.routeMinUsd` and the `route.near-intents`
  label). `/api/out/quote`, `/api/out/build`, `/api/in/quote` and `/api/in/plan` take an optional
  `route: "near-intents"`; absent means the active route, so THORChain requests are unchanged. A route that is not
  built answers 400.
- Key: `ONECLICK_JWT` is read from the server env into `env.oneClickKey` and removed from `process.env`, then sent
  as the `X-API-Key` header only. Errors from the client never carry request headers or transport messages.
- User agent: `oneClick.userAgent` from config, the project's own name and site. The quote host refuses some
  default client signatures (ADR 0048); nothing imitates a browser.
- Dry and real quotes: quotes while a person types are dry (`dry: true`), with placeholder addresses no one holds
  (`oneClick.placeholders`) in place of the refund address. A real quote (`dry: false`, with a deposit address) is
  asked only when the transaction is built: out from `/api/out/build` with `refundTo` = the address of input 0, in
  from `/api/in/plan` with `refundTo` = the connected EVM address (`from`, required; 422 without it). A real quote to
  a placeholder is refused with 422 `placeholder_address`, and a dry quote cannot be built into a payment.
  Placeholders: BCH `bitcoincash:qqqq…fnhks603` (hash160 of zero bytes) and EVM `0x…0001` (a precompile address).
  A dry check on 2026-11-17 20:50 UTC found that 1Click refuses `0x…dEaD` as a refund address ("refundTo is not
  valid") and accepts `0x…0001`.
- Cache: dry quotes are kept in memory for `oneClick.cacheSeconds` (20 s; the schema refuses more than 86400,
  terms 4.1(e)); real quotes and statuses are never kept. Fixtures are synthetic, written from the OpenAPI shapes
  (`tests/fixtures/oneclick/synthetic.json`, marked "synthetic").
- Out deposit: output 0 pays the deposit address the exact `amountIn`, output 1 returns change to input 0, no
  OP_RETURN (the quotes came back with `depositMode: SIMPLE`). `checkTransaction` gets `oneClickDeposit`, rule 6 with
  two outputs; a third output fails rule 6. A quote that asks for a memo, or quotes a different input amount, is
  refused.
- In: one plain ERC-20 `transfer(depositAddress, amountIn)`, no approve, no memo (`InPlan` kind `transfer`; the
  `/api/in/plan` deposit carries `kind: "transfer"`). The page amount (1e8 units) becomes token units with the
  asset's decimals.
- Status: asked by deposit address (`GET /v0/status`), kept on the crossing row (out: the deposit address; in: the
  `vault` in the row's record). `PENDING_DEPOSIT`/`INCOMPLETE_DEPOSIT` = unseen, `KNOWN_DEPOSIT_TX`/`PROCESSING` =
  pending, `SUCCESS` = done, `REFUNDED` = refunded, `FAILED` = failed. After a broadcast (out) or a recorded EVM hash
  (in) the server calls `POST /v0/deposit/submit`; a failure there is noted on the row and does not stop anything.
- Fees: 1Click reports `withdrawFee` in the output asset (already taken from `amountOut`); it is shown as the
  route's fee. The rest of its cost is in the rate, as the quote reports it; no USD conversion is added.
- New config keys: `features.oneClick`, `oneClick.{userAgent, timeoutMs, bchAsset, assets, placeholders,
  cacheSeconds, statusPollSeconds, dryDebounceMs}`; `oneClick.appFeeBps` must be 0. The old `chains`,
  `inMinUsdByChain` and `disabledChains` are replaced by `assets` (one list, each with `live.out` and `live.in`).
- The MCP server and the browser do not call 1Click; nothing under `web/` names the provider host or the key.

## Consequences

- Undo: `features.oneClick` false removes the route from the server; THORChain requests never name a route and are
  unchanged.
- Next: the route row and actions in the page, the terms text, then two measured mainnet runs per direction.
