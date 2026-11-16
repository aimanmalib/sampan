# 0016 Terms and risks pages from config and lang files

Date: 2026-11-16. Status: accepted.

## Context

The site needs a terms page and a risks page in English and Malay. Some sections describe crossings to other chains, which stay
hidden until they are measured on mainnet. The operator's name and the list of sections can change without a code change.

## Decision

- `config/sampan.json` `legal` holds the operator's name and the ordered section keys for `/terms` and `/risks`. A section with
  `"cross": true` is shown only while cross-chain flows are open, by the same rule the front page uses.
- The text lives in `lang/en.json` and `lang/ms.json` under `terms.<key>.*` and `risks.<key>.*`; each risk has a `funds` line
  saying what happens to the user's funds.
- A lang test fails when a listed section has no text in either language or uses a word the terms must avoid.

## Consequences

Adding, removing or reordering a section is a config and lang change. With crossings off, `/risks` shows four of the six risks
and `/terms` leaves out the route section. Going back means removing the two routes from `web/src/App.tsx` and the footer links.
