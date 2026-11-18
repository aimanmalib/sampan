# 0052: THORChain pays a landing address (G3a), measured with the page's own Bring in code

Date: 2026-11-18. Status: accepted.

## Context

Bring in with PUSD as the asset received sends the route's BCH to a landing address (`contracts/landing.cash`,
P2SH20), whose `convert` the server's finisher then spends to pay the owner PUSD. THORChain's quote notes for this
direction say "Do not swap to smart contract addresses" (ADR 0018). That warning is written for EVM chains, but
whether THORChain's Bitcoin Cash client pays a P2SH20 destination had to be measured on mainnet before landing
addresses are offered for crossings (PRD gate G3a; fallback C' otherwise).

The EVM test key held no ether for gas, and there was no tool to run Bring in without a browser wallet.

## Decision

- `tools/test-wallet/gas-fund.ts` makes one funding swap `BCH.BCH` to the chain's gas coin (`ETH.ETH`) for the EVM
  test key: THORChain's quote, its memo checked to name the asset, the key's address and the quoted minimum (the
  short code `e` THORChain quotes for ether is now read by `core/routes/memo.ts`), the deposit checked with
  `checkTransaction` (rule 6) and the VM, refused above `--max-usd` (1.5) or the test budget. It is recorded in the
  test ledger only, never as an `out` row.
- `tools/measure/in-run.ts` runs the page's own `runIn` (`core/client/in.ts`: plan, memo destination and limit
  checked, the landing address recomputed from its card, approve, router deposit) against the built server on this
  host with the crossing and the one asset switched on through `SAMPAN_CONFIG_PATCH`, as `out-run.ts` does for Send
  out (ADR 0044). The EVM side is signed by the test key through a local EIP-1193 provider
  (`tools/measure/evm-key-provider.ts`, viem, one chain only; the key stays in that process). The crossing is traced
  with `traceCrossing` until the BCH is seen at the landing address and the server reports the conversion of that
  payment; flow `g3a` with `--g3a`, else `in`.

## Result

Measured on 2026-11-18 (row `g3a` in `docs/MEASURED.md` Runs): 2 USDC on Ethereum (router deposit
`0x462b684d…`) became 835993 sats paid by THORChain's outbound to the P2SH20 landing address (`99262bb4…`), which the
finisher converted to 1.73 PUSD at the owner address (`175509aa…`, output 0 read back over Electrum); 2021 s from the
deposit to the conversion, most of it THORChain's outbound queue for Bitcoin Cash. The gas funding swap was 450000
sats (USD 0.95, `515ab4dc…`), which arrived as 0.00038086 ETH.

## Consequences

- The route pays a landing address, so Bring in keeps the landing contract as the destination for PUSD; C' is not
  needed for the THORChain route.
- P4c (G4) uses the same tool for its two `in` runs; the gas funding covers them (one Bring in costs about 0.03 USD
  of ether at the gas price measured in ADR 0041).
