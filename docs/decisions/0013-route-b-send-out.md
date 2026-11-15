# 0013: Route B (THORChain) and the Send out flow

Status: accepted, 2026-11-15 (provisional until 2026-11-17 12:00 UTC, when the route choice becomes final)

## Context
The product spec has one internal interface for the cross-chain route and two implementations. Route A needs the
owner's written yes before any request reaches its provider; with no yes, route B (THORChain) is the default. The
route code can be written and tested on fixtures before any mainnet crossing.

## Decision
- `config.route.active` is `thorchain`. Only that module is constructed (`server/routes/index.ts`); route A has no
  module and no code that can call its provider.
- `server/routes/types.ts`: `Route` with `quoteOut`, `buildOut`, `quoteIn`, `buildIn`, `status`, `open`.
- `server/routes/thornode.ts`: documented THORNode endpoints only (`/thorchain/quote/swap`, `/thorchain/tx/status`,
  `/thorchain/inbound_addresses`); nodes from config tried in order, a THORChain refusal (4xx with a message) is final.
- No `tolerance_bps` is sent. The limit is `floor(expected_amount_out x (1 - thorchain.slippageBps / 10000))`, written
  into the quote's memo (`core/routes/memo.ts`, at most 80 bytes). BCH destinations go without the `bitcoincash:` prefix.
- The deposit (`core/tx/deposit.ts`): output 0 pays the vault the quoted amount, output 1 returns change to the address
  of input 0, output 2 is the OP_RETURN memo; plain P2PKH coins only; fee rate at least the quote's recommended rate and
  at most `thorchain.maxGasRate`. Change below dust is refused instead of dropping the change output.
- `checkTransaction` rule 6 enforces that shape when the expectation says `thorDeposit`. The page also checks that the
  memo names the asset and the address typed on the page and carries a limit at least the minimum shown. The vault
  address itself comes from the server's quote; the page cannot verify it without calling THORNode itself.
- From the stablecoin, Send out is two signatures: step 1 is the existing swap (tokens to BCH at the wallet's receive
  address), step 2 deposits that BCH as input 0. The step 1 quote reserves the step 1 fee cap, a step 2 fee at
  `thorchain.maxGasRate` for an 80-byte memo, and dust for the change, so no BCH of the user's own is needed. If step 2
  does not finish, the page says the BCH is in the wallet and offers to continue or swap back.
- `/api/out/quote` and `/api/out/build` answer 503 `route_paused` while `compliance.crossChainEnabled` is false, and the
  Send out tab only shows when it is true. It stays false on the public site until the mainnet gates for both
  directions pass.
- `SAMPAN_FAKE=1` answers THORNode requests from frozen mainnet captures in `tests/fixtures/thorchain`.

## Consequences
The first mainnet deposit must be preceded by a check of the final memo format against the THORChain memo
documentation. Bring in from another chain (router `approve` + `depositWithExpiry`) uses `quoteIn`/`buildIn` from the
page's EVM wallet code, which is a later slice.
Rollback: set `route.active` to `none`; the tab, the endpoints' service and the route module are then not built.
