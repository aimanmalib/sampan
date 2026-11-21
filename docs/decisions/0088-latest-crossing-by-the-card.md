# 0088: The latest real crossing by the card

Date: 2026-11-21

## Context

The front page says how many crossings were measured on mainnet, but a visitor does not see one of them unless they
open /how. One real crossing next to the card, with its two transactions one click away, shows the product working
without asking the visitor to trust a count.

## Decision

- **Picked, not typed.** `core/hero-proof.ts` reads the Runs table of `docs/MEASURED.md` (through the same
  `virtual:sampan-proof` build-time module as /how) and takes the newest ok row that brings a stablecoin into PUSD
  (flow `in` or `oc-in`), whose amount cell reads `<amount> <CHAIN>.<SYMBOL> to PUSD`, whose symbol is in
  `config.route.symbols`, and which records both the BCH transaction and the other chain's transaction. A new ok row
  in the table changes the line at the next build.
- **What it says.** "Latest crossing: 1.6 USDC from Avalanche C-Chain to PUSD", plus "in N s" when the row has a time,
  then links to both transactions (explorers from config, the same helper as the /how table) and to `/how#proof`. The
  chain name comes from `config.evm.chains`. Words are lang keys `heroProof.*` in every language.
- **Config.** `ui.heroProof`: `latest-in` draws the line, `none` removes it (the way back, no code change).
  `ui.heroTab`: the card's tab before a visitor picks one (`swap`, `in` or `out`); shipped as `swap`, so the judge path
  (0.001 BCH on the Swap tab, the judge strip filling Bring in) is unchanged. A tab that is not open falls back to the
  first open tab.
- **Layout.** The line sits under the pitch and stays on the first screen (e2e/first-screen.spec.ts checks it in every
  language on an iPhone 13 and at 1440x900 and 1280x720). Wide screen: its own row in the left column under the status
  chips, and the card spans one row more. Phone: one line that scrolls sideways, like the status chips row, because
  there is no room for a second line. To make room on the phone, the Malay and Filipino "You receive" sentences were
  shortened to one line, as the English one already was.

## Consequences

- The line only ever names a crossing the measured table records with both transaction ids.
- On a phone the transaction links can sit past the right edge until the visitor scrolls the line; the label and the
  crossing itself are always in view.
