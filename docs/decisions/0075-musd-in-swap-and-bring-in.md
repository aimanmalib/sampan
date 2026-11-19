# 0075: MUSD in Swap and Bring in, behind its flag

Date: 2026-11-19. Status: accepted.

## Context

ADR 0072 measured the MUSD Cauldron pools (47 of 47 checked, slip about 0.3 % both ways at 0.001 BCH). The landing
address and the swap service already accepted MUSD while `features.musd` is on, but Bring in, Send out and the page
offered the default token only, and the measuring tools could not name MUSD. MUSD stays off until two measured swaps
and one measured crossing (the next step) are recorded among the measured runs.

## Decision

- One rule names the tokens the server works with: `tokenOffered` in `core/config.ts` (the default token, and MUSD
  while `features.musd` is on). The swap service, landing service, Bring in (`receive`) and Send out (step 1 `source`)
  all use it, and the public config lists the same tokens. Nothing else changes while the flag is off.
- Swap tab: when the public config lists more than one token, a "Stablecoin" choice (`swap.token`) sits under the
  direction; one token draws nothing. Bring in: the "You receive" choice lists every offered token and BCH; the landing
  address is made for the chosen token's category. `contracts/landing.cash` is unchanged.
- Measuring: `tools/measure/swap.ts --token MUSD`, `in-run.ts --receive MUSD` and `out-run.ts --source MUSD` switch
  `features.musd` on in their local server only and write rows that name MUSD.
- The fake network serves the captured pools under every offered token, each copy with its own txid, so the e2e
  server with the flag on (`networkPatch`) can quote and build MUSD.

## Rollback

`features.musd` false (the shipped value) hides MUSD everywhere; the code paths are those of the default token.
