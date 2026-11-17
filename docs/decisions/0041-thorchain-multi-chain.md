# 0041 THORChain on more than one chain: read-only pre-check

Date: 2026-11-17. Status: accepted.

## Context

The THORChain route took Base only, and THORChain halted trading on Base on 2026-11-16. The route can pay out and take
in stablecoins on several chains. Before the config lists them, each asset needs its state, its quote in both
directions at the test amounts, its token decimals read from the chain, two public RPC endpoints that answer, and the gas
for one bring-in. Nothing in this slice sends a transaction.

## Measurements (2026-11-17 04:03 to 04:07 UTC)

THORNode `https://gateway.liquify.com/chain/thorchain_api` (`/thorchain/inbound_addresses`, `/thorchain/pools`,
`/thorchain/quote/swap`). BCH price from the pool's `asset_tor_price`: 209.14 USD. Test EVM address
`0x1a877169bB03400fA69EC4813889E78994D194Cb`.

`inbound_addresses`: BCH, ETH, BSC, AVAX and TRON have `halted`, `chain_trading_paused` and `global_trading_paused` all
false. BASE has `halted: true` and `chain_trading_paused: true`. Routers: ETH `0xD37BbE5744D730a1d98d8DC97c42F0Ca46aD7146`,
BSC `0xb30ec53f98ff5947ede720d32ac2da7e52a5f56b`, AVAX and BASE `0x00dc6100103BC402d490aEE3F9a5560cBd91f1d4`.

| asset (pool `Available`) | chain open | decimals (read) | out: BCH ~USD 2 / ~USD 3 -> received | outbound fee | in: 3 units -> sats | in min | gas for one in (USD) |
|---|---|---|---|---|---|---|---|
| ETH.USDC | yes | 6 | 1.746531 / 2.744833 | 0.250081 | 1312270 | 0.812688 | 0.0282 |
| ETH.USDT | yes | 6 | 1.748457 / 2.747857 | 0.250356 | 1310677 | 0.813591 | 0.0265 |
| BSC.USDC | yes | 18 | 1.74771337 / 2.7465946 | 0.25020781 | 1310394 | 0.81367365 | 0.0033 |
| BSC.USDT | yes | 18 | 1.74453125 / 2.74164698 | 0.24977271 | 1313131 | 0.81216549 | 0.0031 |
| AVAX.USDC | yes | 6 | 1.745131 / 2.742596 | 0.249861 | 1312648 | 0.812442 | 0.0073 |
| AVAX.USDT | yes | 6 | 1.746039 / 2.744009 | 0.250001 | 1311864 | 0.812874 | 0.0072 |
| TRON.USDT | yes | 6 (TronGrid `triggerconstantcontract`) | refused: minimum 4504554 sats (~USD 9.42) | 3.032739 at 4600000 sats | 1315367 | 9.398907 | not EVM |
| BASE.USDC | no (halted) | 6 | refused: "trading is halted" | n/a | refused | n/a | ~0.0017 (upper bound, see below) |

- Out amounts: 956297 sats (~USD 2) and 1434445 sats (~USD 3); `recommended_min_amount_in` 388611 sats for every EVM
  asset. Total fee 1128 bps at USD 2 and 787 bps at USD 3: the outbound fee is flat, about 0.25 of the stablecoin.
- In: 3 units of the stablecoin to the test BCH address; outbound fee 119550 sats on every asset.
- Memos as returned by THORNode: out `=:<CHAIN>.<SYMBOL>:<0x address>`, in `=:c:<cash address without prefix>`. A cash
  address with its `bitcoincash:` prefix is refused as a destination (the colon splits the memo), as the client already
  sends it.
- Gas for one bring-in = `eth_estimateGas` of `approve(router, 3 units)` from the test address plus the median `gasUsed`
  of recent successful token deposits to that chain's router (receipts of `Deposit` logs with a non-zero asset), times
  `eth_gasPrice`, times the gas asset's pool price. ETH: approve 56361 (USDC) / 48936 (USDT), deposit samples 58085,
  68758, 69267, 0.1232 gwei, ETH 1830.60 USD. BSC: approve 54235 / 46576, deposits 51649, 58150, 66004, 0.05 gwei,
  BNB 593.60 USD. AVAX: approve 56216 / 54367, one deposit 80000, 7.506 nAVAX, AVAX 7.17 USD. BASE: approve 56216, no
  deposit in recent blocks while halted, so 100000 gas is assumed as an upper bound at 0.006 gwei.
- Funding swaps for gas (quotes, test EVM address): 400000 sats -> 0.00031948 ETH (outbound fee 0.00013659 ETH);
  717000 sats -> 0.00068093 ETH, 0.00209992 BNB (minimum 443799 sats), 0.17377127 AVAX.
- Test wallet: 0.02670487 BCH and 0.81 PUSD on Bitcoin Cash (all three derivation paths walked to the gap limit);
  0 native gas and 0 stablecoin on ETH, BSC, AVAX and Base.

RPC endpoints (`eth_chainId` and `eth_blockNumber` both answered):

| chain | endpoint 1 | endpoint 2 | source |
|---|---|---|---|
| ETH (1) | `https://ethereum-rpc.publicnode.com` | `https://eth.drpc.org` | provider pages publicnode.com and drpc.org (Ethereum has no endpoint run by the protocol's own docs) |
| BSC (56) | `https://bsc-dataseed.bnbchain.org` | `https://bsc-dataseed.defibit.io` | docs.bnbchain.org JSON-RPC endpoint page |
| AVAX (43114) | `https://api.avax.network/ext/bc/C/rpc` | `https://avalanche-c-chain-rpc.publicnode.com` | build.avax.network C-Chain RPC page; publicnode.com |
| BASE (8453) | `https://mainnet.base.org` | `https://base-rpc.publicnode.com` | docs.base.org "Connecting to Base"; publicnode.com |

`https://eth.llamarpc.com` returned HTML and `https://cloudflare-eth.com` refused `eth_blockNumber`; neither is used.
Public endpoints limit `eth_getLogs` ranges (200 to 2048 blocks); Sampan does not call `eth_getLogs` in its flows.

## Decision

- Assets listed in config: ETH.USDC, ETH.USDT, BSC.USDC, BSC.USDT, AVAX.USDC, AVAX.USDT, TRON.USDT and BASE.USDC, each
  with `live` false until a measured `ok` run exists for that asset and direction. DAI, GUSD, LUSD, USDP and BUSD pools
  are not listed (small pools; BUSD is no longer issued). Adding one later is a config row plus a measurement.
- First chain: Ethereum, ETH.USDC. At USD 3 out it delivers 91.5 % of the amount (rule: at least 50 %), and one bring-in
  costs about USD 0.03 in gas (rule: at most USD 1). The fallbacks, in order, are BSC.USDC then AVAX.USDC; both pass the
  same rule today.
- Measurement amount for an EVM out: 600000 sats (~USD 1.25 at 04:06 UTC; quoted 1.001947 ETH.USDC, 1.00328819
  BSC.USDC, 1.001792 AVAX.USDC). That is above the 388611 sats minimum, keeps at least 50 % after the flat fee, and
  delivers more than the about 0.81 unit minimum of a bring-in, so the stablecoin from an out run can fund an in run.
  Before each run the live quote is read again; a quote under 50 % or under the in minimum means a larger amount, never
  above the per-transaction limit.
- Gas funding for an EVM chain's bring-in runs: one swap `BCH.BCH` -> the chain's gas asset of about 400000 sats on
  Ethereum (about 10 times the gas of two bring-ins at today's price, and still enough at 1 gwei), at most USD 1.5 on any
  chain, recorded in the budget ledger and not counted as an `out` row.
- TRON.USDT out cannot be measured under the USD 3 per-transaction limit: THORChain's minimum today is about USD 9.4
  (outbound fee about 3 USDT). It stays in the list with `live` false. The out code can still be written; the
  measurement waits until the minimum falls under the limit.
- BASE.USDC stays listed with `live` false and is hidden while Base is halted; it is measured when THORChain reopens it.
- Funds: the test wallet's 2670487 sats cover the Ethereum chain (two outs of 600000 sats plus one 400000 sats funding
  swap = 1600000 sats, plus miner fees). One more chain needs about 1600000 sats again (BSC's gas funding minimum is
  443799 sats), so adding chains after Ethereum needs more test funds.

## Consequences

Config and server (2026-11-17, the slice after the pre-check):

- `thorchain.assets` is the one list (`asset` exactly as `/thorchain/pools` names it, `chain`, `symbol`,
  `live: { out, in }`). `route.symbols` and `thorchain.chains` are gone; validation refuses them if they come back.
  `/api/config` publishes only live assets (`routeAssets`) and derives `route.symbols` and `routeChains` from them.
- `evm.chains[]` has one entry per EVM chain: `rpc` is a list of at least two https endpoints, `native` names the gas
  coin a wallet is told about, and `tokens.<SYMBOL>` is `{ address, decimals }` with the decimals read above. Each
  asset's contract must match its chain entry. TRON has no EVM entry: it may be listed, never live, until its own
  client code exists.
- The route's `open()` returns one map of chain to open (one `inbound_addresses` read per health check). The route
  counts as open while BCH and at least one live asset's chain are open; `/api/health` carries the map. A closed
  chain refuses only its own assets with 503 `chain_halted`; an asset not live for that direction gets 400. Nothing
  lists halted chains in code: a chain that reopens is offered again at the next check.
- The page approves amounts in the decimals config lists and stops before signing when the token reports others.
- The synthetic `thornode` probe fails only when BCH or every live chain is closed; one closed chain is detail.
- `tools/measure/cross.ts --asset <asset>` reads chain, token and RPCs from config; the txid cell names the chain
  (`bch … · eth 0x…`). Earlier `base 0x…` rows stay valid.

Rollback: revert the config and server commit; no deploy carried it.
