# 0009 Page text and tabs follow the flow flags

Date: 2026-11-15. Status: accepted.

## Context

The page promised flows and assets that were not open yet: crossings in both directions, USDT, and fee-free crossings. The
tabs for closed flows showed a "Not open yet" note. Text on the page must describe only what a visitor can do today.

## Decisions

- **Three flows, three flags.** Swap (`features.swap`), landing address (`features.landing`, new, off until it is measured on
  mainnet) and crossing (`compliance.crossChainEnabled` with an active route and at least one asset in `route.symbols`).
  `core/flows.ts` turns the config into the set of open flows.
- **One lang key per combination.** The hero line (`hero.sub.<combo>`) and the page description
  (`meta.description.<combo>`) have a whole sentence for each of the eight combinations in both languages, instead of sentence
  parts glued together. The key type comes from the lang file, so a missing combination fails the type check. A test checks that
  each text names exactly the open flows.
- **Assets from config.** Texts that mention crossed assets use `{symbols}`, filled from `route.symbols`. The route on Base
  carries USDC only, so `route.symbols` is `["USDC"]`.
- **Closed flows have no tab.** A tab is drawn only when its flow is open and its panel exists. With no open flow the card is
  not drawn. The "Not open yet" text is gone.
- **Static description.** `index.html` gets the description for the flags in `config/sampan.json` at build time; the page sets
  it again from the live config.

## Undo

Revert the commit; the earlier lang keys and the three fixed tabs come back.
