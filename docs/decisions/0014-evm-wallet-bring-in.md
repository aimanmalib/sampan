# 0014: EVM wallet in the page and "Bring in" from another chain

Status: accepted, 2026-11-15

## Context
Route B (THORChain) takes tokens from an EVM chain only through its router: `approve(router, amount)` and then
`router.depositWithExpiry(vault, asset, amount, memo, expiry)`. A plain token transfer to the vault is not counted, so
there is no deposit address to show. The user's own EVM wallet must sign, and the page must not need a key or an
account with any wallet service.

## Decision
- Discovery is EIP-6963 only (`web/src/evm/store.ts`): each extension announces its own name and icon; the icon is
  drawn only when it is a `data:image/` URI, so the page still loads no third-party images. One connection is shared by
  the Send out and Bring in tabs and is not remembered between visits. WalletConnect stays off until its project id
  is set in config (separate slice).
- Calldata is built in `core/evm/calldata.ts` with `viem`'s ABI encoder: the approval is for the exact amount, never
  unlimited, and is skipped when the allowance already covers it (`zeroFirst` exists for tokens that refuse to change a
  nonzero allowance). Amounts convert from THORChain's 1e8 units to the token's own decimals, read from the token with
  `eth_call`; an amount the token cannot carry exactly is refused.
- The server answers `/api/in/quote` (quoted to the user's BCH address, no landing address while typing),
  `/api/in/plan` (fresh quote; for the stablecoin it opens a landing address priced at the route's minimum output with
  `landing.toleranceBps`, then quotes again to that address) and `/api/in/:id/sent` (records the source tx hash once,
  upper-case hex without `0x`, the form THORNode's status endpoint takes). All answer 503 while
  `compliance.crossChainEnabled` is false.
- Before the wallet opens, the page checks the plan (`core/evm/check-in.ts`): token, amount, unexpired, router and vault
  present, and a memo that pays the chosen BCH address (THORChain's `c` short code for BCH accepted) with a limit at
  least the minimum shown. A landing address is recomputed from its card as in flow L. Each call is simulated with
  `eth_call` before `eth_sendTransaction`.
- When an approval was needed and the plan is older than `evm.replanSeconds`, a new plan is fetched and checked before
  the deposit is signed. Polling for the approval receipt uses `evm.receiptPollSeconds` up to `evm.receiptWaitSeconds`.
- A short disclosure (three lines and "I understand") shows once before the first crossing in either direction and is
  remembered in `localStorage`.
- Without an EVM wallet in the browser the panel says to open the page in a wallet's browser or on a computer with a
  wallet extension; no vault address is ever shown as a payment address.

## Consequences
The flow is tested against the fake THORNode and fake EIP-1193 providers (unit and both browser engines); the first
mainnet crossing in, through the router and a landing address, is a later measured slice. The tab stays hidden on the
public site until then. Rollback: `compliance.crossChainEnabled` false hides both cross-chain tabs and the endpoints.
