# 0096: MUSD is switched on, with its Swap choice shown once a wallet is connected

Status: accepted, 2026-11-21

## Context

MUSD was built behind `features.musd` (ADR 0075) after its pools were measured (ADR 0072). The flag stayed off
until MUSD swaps and an MUSD crossing were measured on mainnet. Those runs are now in `docs/MEASURED.md`: one swap
each way (0.001 BCH to MUSD, MUSD back to BCH) and one Bring in of 1.55 USDT on Avalanche C-Chain that a landing
address turned into MUSD.

With the flag on, the Swap card draws a PUSD / MUSD choice as an extra row. Swap is the tab on the first screen, and
that row pushed the card below the first screen of an iPhone 13 (`e2e/first-screen.spec.ts`) and of a 1440 x 900
desktop (`e2e/front.spec.ts`). The first screen is fixed: nothing new is added to it.

## Decision

- `features.musd` is true in `config/sampan.json`.
- The Swap card shows the stablecoin choice only while a wallet is connected. That is the point where the card
  already grows with the wallet balance line, and the balance line names the chosen token. Without a wallet the
  swap quotes the default token (PUSD), as before.
- Bring in keeps its "As MUSD" choice as it is: that tab is not the first screen.
- The measuring tool `tools/measure/swap.ts` no longer reads the PUSD peg note (it shares the error style) as a
  failed swap: it waits for an error that is not the peg note.

## Consequences

- A visitor without a wallet sees PUSD in Swap. MUSD is one click away after connecting, and in Bring in at once.
- The way back is `features.musd: false`: Swap and Bring in return to PUSD only.
