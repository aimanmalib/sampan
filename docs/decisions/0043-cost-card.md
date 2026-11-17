# 0043: Cost card before signing (Send out and Bring in)

Date: 2026-11-17. Status: accepted.

## Context

Send out and Bring in showed the amount received and the route's fee total, with the rest folded away. A user could
not see, before the wallet asks to sign, what the whole crossing costs in one currency, what that cost is made of,
how much of the value is kept, how long it takes and how long the price holds.

## Decision

- One pure module, `core/cost.ts` (bigint, no I/O), turns the quote the transaction is built from into a card:
  pay, receive, total cost in USD with named parts, the share kept, price impact, time, and the quote's expiry.
  `core/client/cost.ts` maps the server's quote replies to it; the page and the measuring tool use the same mapping.
- Prices come from the same quotes only. The BCH price is what THORChain pays (out) or charges (in) for the
  satoshis of that quote: expected output plus its named fees, over the satoshis. PUSD and the other chain's stablecoin count as USD 1
  and the card says so. The source chain's gas coin is valued at THORChain's own pool price of that coin
  (`/thorchain/pool/<CHAIN>.<COIN>`, `asset_tor_price`), read by the server with the bring-in quote. No outside
  price feed is used.
- Parts: Bitcoin Cash network fee (swap and deposit, from the transaction sizes at the quoted rate), Cauldron pool
  fee (0.3 % of the BCH side, from the pool math), Cauldron price impact and the gap to THORChain's price (what the
  swap gave, valued at the quote's price, against what was paid), Sampan fee when not zero, THORChain liquidity,
  outbound and affiliate fees as THORNode names them, gas on the source chain, and the network fee of the conversion
  at a landing address. BCH that stays in the user's own wallet (the step 1 margin of Send out from PUSD, the token
  dust of a landing) is listed apart and is not a cost. The parts add up to what is paid minus what is received and
  kept, to under a hundredth of a cent (tests/cost.test.ts).
- Price impact shown is THORChain's `slippage_bps` plus the Cauldron trade's impact against the pools' spot price
  (fee apart). A warning shows when the impact, or the whole cost as a share of what is paid, is above
  `limits.feeWarnBps`.
- Time: "about A to B min", A = THORNode's `total_swap_seconds` plus one block of the source chain
  (`connect.bchBlockSeconds`, `evm.chains[].gas.blockSeconds`), B = the median of the ok runs of that direction and
  chain in docs/MEASURED.md as the page was built; one value when there is no run or both round the same.
- Gas: units from config (`evm.chains[].gas.approve` and `.deposit`, the measured medians of ADR 0041), times the
  chain's `eth_gasPrice` from its configured public RPC, read by the page. `eth_estimateGas` of a router deposit
  needs a balance and an allowance the user may not have yet, so it is not used for the card. With a wallet
  connected the page reads the allowance and leaves the approval out when it already covers the amount; without
  one the approval is counted. On the fake server no RPC is called and the card says gas is extra.
- `tools/measure/cross.ts --cost <quote.json>` saves the card of a run's quote to `state/cost-shown/<txid>.json`
  before broadcast, so the card can later be set against what was paid.

## Rounding and one statement of the cost

- Amounts are rounded half away from zero, not cut. The headline line rounds what is paid, what is received and
  what stays in the wallet first, and shows the total as their difference, so the three add up to the total on the
  screen cent for cent. The total can differ from the sum of the named parts (rounded one by one in the details) by
  the rounding only.
- In Send out the card replaces the older fee warning and the fee details under the button while it is shown; they
  come back only when there is no card (no named fees from the server, or the atomic route).

## Consequences

- The quote replies gain fields (named fees, `depositNetworkSats`, `router`, `convert`, `gasAssetUsdE8`, and the
  swap's `poolFeeSats`, `impactBps`, `networkSats`); older clients ignore them, and the page shows no card for a
  server that does not send the named fees.
- A Bring in quote that receives PUSD also asks Cauldron for the trade the landing address would make.
- Undo: remove the `CostCard` lines from `OutPanel.tsx` and `InPanel.tsx`; nothing else depends on the card.
