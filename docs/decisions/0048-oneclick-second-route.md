# 0048: 1Click (NEAR Intents) as a second route, pre-check

Date: 2026-11-17. Status: accepted. Read-only check: no transaction was signed or sent.

## Context

The owner's note `bch 1click ya sasateguh` (17 Nov) asks for the NEAR Intents 1Click API as a SECOND route next to
THORChain, compared in the "Choose a route" card (ADR 0039, ADR 0040). It replaces the earlier note `bch 1click tak`
(16 Nov). ADR 0013 kept route A without a module until a written yes; that yes now exists. The owner accepted the
1ClickSwap API terms and chose the operator name "Sasa Teguh (SASA TEGUH DIGITAL SOLUTION, Malaysia)". The API key
(JWT) is kept by the owner in the server env file as `ONECLICK_JWT`; it is present on this host (its value was not
read into any file, log or test).

This record is the read-only pre-check before any code: official documents re-read, four dry quotes, test wallet
balances, and how each term of use is met.

## Sources (read 2026-11-17 20:15 UTC)

- Index: https://docs.near-intents.org/llms.txt
- Making a request: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md
- Swap types: https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types.md
- Supported chains: https://docs.near-intents.org/resources/chain-support.md
- Fees: https://docs.near-intents.org/resources/fees.md
- Swap limits: https://docs.near-intents.org/resources/swap-limits.md
- API keys: https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication.md
- Quote signatures: https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature.md
- Risk and compliance: https://docs.near-intents.org/security-compliance/risk-and-compliance.md
- 1ClickSwap API Terms of Use, "Last Updated: October 7, 2026":
  https://docs.near-intents.org/security-compliance/terms-of-service.md
- OpenAPI: https://1click.chaindefuser.com/docs/v0/openapi.yaml

## What the documents say

- Endpoints used: `GET /v0/tokens`, `POST /v0/quote` (`dry: true` returns a quote without a deposit address;
  `dry: false` returns the deposit address), `POST /v0/deposit/submit`, `GET /v0/status`.
- Key: sent as `X-API-Key` (the API keys page also accepts `Authorization: Bearer` for the same JWT). Without a key
  every non-`ANY_INPUT` quote carries an extra 0.25 %. With a key and no `appFees`: 0.20 %, or 0.01 % for stablecoin
  pairs. Sampan sends no `appFees` (its own fee is 0).
- Swap limits: Bitcoin Cash, Ethereum, Base and Avalanche have no USD minimum. BNB Chain has a USD 1,000 minimum
  and Tron (as origin) USD 100, both far above the per-transaction test budget of USD 3.
- Bitcoin Cash accepts every address type, CashAddr P2SH included. The quote request's `depositMode` defaults to
  `SIMPLE` (deposit address only); `MEMO` is named for chains such as Stellar. The dry quotes below came back with
  `depositMode: SIMPLE`, so a BCH deposit needs no memo and no OP_RETURN.

## Asset ids (`GET /v0/tokens`, 232 tokens)

| Asset | 1Click asset id | decimals |
| --- | --- | --- |
| BCH | `nep141:bch.omft.near` | 8 |
| USDC on Ethereum | `nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near` | 6 |
| USDT on Ethereum | `nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near` | 6 |
| USDC on Base | `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` | 6 |
| USDC on BNB Chain | `nep141:bnb-0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d.omdep.near` | 18 |
| USDT on BNB Chain | `nep141:bnb-0x55d398326f99059ff775485246999027b3197955.omdep.near` | 18 |
| USDC on Avalanche | `nep141:avax-0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e.omdep.near` | 6 |
| USDT on Avalanche | `nep141:avax-0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7.omdep.near` | 6 |
| USDT on Tron | `nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near` | 6 |

Base USDC is listed even though THORChain had Base trading halted (ADR 0041); the second route only offers assets
that the THORChain route also offers, so Base stays out with it.

## Four dry quotes (2026-11-17 20:17 UTC, with the key, `EXACT_INPUT`, slippage 100 bps)

Out: refund address = the test wallet's BCH address; recipient = the test wallet's EVM address. In: recipient = the
test wallet's landing address (`bitcoincash:pzl6a7f26y4mrzx7h8j9dlagpvs8wzum2y77e8dufw`, P2SH20, from receive/13);
refund address = the test wallet's EVM address. All four answered HTTP 201 with a quote.

| Direction | In | Out (quoted) | Minimum out | Received / sent (USD) | `timeEstimate` | `withdrawFee` | `refundFee` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BCH to USDC (Ethereum) | 964460 sats (USD 2.00) | 1.699135 USDC | 1.682143 USDC | 84.9 % | 114 s | 0.300000 USDC | 500 sats |
| BCH to USDC (Ethereum) | 1446690 sats (USD 3.00) | 2.698700 USDC | 2.671713 USDC | 89.9 % | 114 s | 0.300000 USDC | 500 sats |
| USDC (Ethereum) to BCH | 2.000000 USDC | 959094 sats | 949503 sats | 99.5 % | 162 s | 500 sats | 0.300000 USDC |
| USDC (Ethereum) to BCH | 3.000000 USDC | 1438891 sats | 1424502 sats | 99.5 % | 162 s | 500 sats | 0.300000 USDC |

USD values are the ones the quote reported (`amountInUsd`, `amountOutUsd`). `timeEstimate` is the provider's own
estimate, not a measurement. The landing address is accepted as a recipient, so the in direction is possible.
Raw responses were read on the host to confirm their shape and are not stored in the repository.

Client note: the quote host rejected a request carrying Python's default client signature (HTTP 403, error 1010) and
answered a request with a plain `sampan-measure/0.1` user agent and Node's default `fetch`. The server module sends
its own honest user agent from config; nothing imitates a browser.

## Test wallet (`tools/measure/funds.ts`, 2026-11-17 20:18 UTC)

BCH 0.11297102, PUSD 0.03; Ethereum 0 ETH and 3.091652 USDC; every other configured chain 0. An out run needs only
BCH. An in run sends one ERC-20 `transfer` and needs ETH for gas, which the THORChain in runs need as well: one gas
funding swap serves both and is counted in the daily budget, not as a run.

## Decision

- Add, do not switch: `config.route.active` stays `thorchain`. 1Click becomes one more row in "Choose a route",
  behind `features.oneClick` and `oneClick.live.{out,in}`, all false until two measured mainnet runs per direction.
- First asset: USDC on Ethereum, the same asset as the live THORChain route, so a row compares the same amount and
  the same received asset. Other assets follow only where THORChain offers them and the swap limit fits the budget
  (not BNB Chain, not Tron as origin).
- Client: plain `fetch` with types written from the official OpenAPI, following the THORNode module (injected fetch,
  timeout from config, fake for tests). The official TypeScript SDK (ISC) is not added: four endpoints do not need
  a generated client, and a smaller dependency list is easier to review.
- Time limit: a 1Click row is shown only if it is measured and done before 2026-11-20 16:00 UTC. Otherwise the code
  stays hidden behind its flag and no page, README or submission text mentions 1Click or NEAR Intents.

## How each term is met

| Term | How |
| --- | --- |
| 4.1(a) no standalone proxy or gateway | Only Sampan's own flow endpoints (`/api/out/*`, `/api/in/*`) call 1Click, with the existing rate limits. The browser never calls it; the MCP server does not expose it. |
| 4.1(b) no competitive product or benchmarking | The card is a route choice for the person swapping. No public benchmark table of 1Click; the "receives more" label states a fact of two quotes for the same amount. |
| 4.1(e) no caching over 24 hours | Quotes and tokens are cached in memory with `oneClick.cacheSeconds` (schema maximum 86400). Only static records of a person's own crossing are kept (txids, deposit address, amounts, final status). Test fixtures are synthetic, built from the OpenAPI schema; no API data trains anything. |
| 4.1(f), 4.1(g), 4.1(j) screening and safeguards | Sampan has no accounts and holds no funds. The risk-based measures built are the region block (ADR 0017), `compliance.blockedCountries`, rate limits and `limits.maxUsd`. The owner was told about 4.1(f) when accepting the terms. |
| 4.1(h) originating address unmasked | `refundTo` is the person's own address (the first input's address for out, the connected EVM address for in); the recipient is their own address or their own landing address. No intermediate address of ours. A real quote with a placeholder address is refused by the server and by `checkTransaction`. |
| 4.1(i), 4.2 end-user terms | `/terms` gets a 1Click section shown only when the flag is on: release of Intents Technology and its affiliates, no warranties from them, irreversible transactions with network fees, slippage and cross-chain risks, the person bears wallet and chain risks, no use by Restricted Persons or from Restricted Jurisdictions, no promise of pricing, execution or uptime, no contract or rights against Intents Technology, and no statement made on their behalf. |
| 4.5 security incidents | `docs/OPERATIONS.md` gets an incident step: an incident touching 1Click is raised to the owner at once with the facts; the owner informs Intents Technology within 24 hours; no public statement by Sampan's tooling. |
| 4.6 UK financial promotion | The three sentences of 4.6 appear word for word in English in `/terms`; other languages quote the English and add a marked translation. |
| 4.7 prohibited representations | 1Click is named as the provider's service, never as Sampan's. No uptime, speed or performance claims; any time shown is "measured on our N runs, not a promise". No logo, and no wording that suggests an alliance or sponsorship. |
| 9.1 restricted jurisdictions | The terms leave the list to "a separate access or compliance policy". The Risk and Compliance page read on 2026-11-17 names no country list, so `compliance.blockedCountries` is kept as it is and nothing is guessed. Checked again before the row is shown. |
| Operator | `legal.operator` becomes "Sasa Teguh (SASA TEGUH DIGITAL SOLUTION, Malaysia)" with a new `legal.updated` date, in the slice that adds the 1Click terms. |

## Consequences

- Next slices: the server module, config and synthetic tests (no deploy); the route row and terms text; two
  measured out runs and two measured in runs on mainnet within the daily budget, THORChain runs first.
- Undo: `features.oneClick` false hides every 1Click row and the terms section; no other route changes.
