# 0053: Crossings switched on for USDC on Ethereum after the G4 runs

Date: 2026-11-18. Status: accepted.

## Context

PRD gate G4 opens cross-chain crossings only after two measured Send out and two measured Bring in runs end to end
on mainnet, and each route asset is offered only in the directions it was measured (ADR 0041). USDC on Ethereum is
the first chain (Base was halted by THORChain when the runs were planned).

## Decision

- Measured with the page's own client code against the built server on this host (ADR 0044, ADR 0052), signed by the
  test wallet and the EVM test key, inside the test budget. Runs rows in `docs/MEASURED.md` (2026-11-17 and
  2026-11-18):
  - Send out to USDC on Ethereum: three `out ok` rows (two of 1.8 PUSD, one of 0.014 BCH that also funded the two
    Bring in runs below).
  - Bring in from USDC on Ethereum to PUSD through a landing address: one `g3a ok` row (ADR 0052) and two `in ok`
    rows of 1.8 USDC each. The THORChain payment to the landing address and the conversion to PUSD are both read
    back from the chain before a row is written.
  - The contract's way back to the owner (`giveBack`) has its own `ok` row from 2026-11-15.
- `config/sampan.json`: `compliance.crossChainEnabled` true, the ETH.USDC asset `live` both ways, `route.symbols`
  `["USDC"]` (the symbols of the live assets, checked by config validation). Every other asset stays off until its
  own rows exist.
- Unit tests that check the answers given while crossings are off now start from the shipped config with every
  crossing switched off (`tests/helpers/cross-off.ts`), so they no longer depend on which assets the config file
  marks live.

- First screen with crossings on (PRD 4.10: headline, card and its one primary button in view without scrolling, on a
  phone and on desktop, in every language, also after "Fill this in for me"): the route line ("The crossing between
  chains is carried by THORChain") now follows the card instead of the headline, and in Bring in the landing form's
  "From … → Arrives as …" line is hidden while the source chooser above it already names the source. No text changed.
- Browser tests: each fake server states its own flows (the swap-only and landing servers switch crossings off, and
  route assets start off so a server's live list is the one it names); the first-screen test runs on a new fake
  server with the shipped flows, so it checks the page the live site shows.

## Consequences

- The live site offers Send out and Bring in for USDC on Ethereum, the health line includes the route, and new
  crossings pause when THORChain reports the BCH or ETH chain halted (ADR 0017, ADR 0041).
- Undo: set `crossChainEnabled` false (or the asset's `live` flags false), build and deploy; nothing else changes.
