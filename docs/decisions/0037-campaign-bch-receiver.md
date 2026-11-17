# 0037 No BCH receiver for donation campaigns, and how BCH Bull is described

Date: 2026-11-17

## Context

A donation campaign on Bitcoin Cash (a crowdfunding page that collects BCH) is an example of someone who wants to be paid
by many people and may want to keep the money in dollars. We looked at whether a landing address could serve as the
receiving address of such a campaign.

The landing contract (`contracts/landing.cash`) does not fit as it is:

- `convert` requires output 0 to carry the fungible token of `tokenCategory` to `ownerLock`, at or above the rate. The coin
  can only leave as the stablecoin; a campaign that wants plain BCH cannot use this path.
- `giveBack` pays plain BCH to `ownerLock` only once the coin is `returnAfter` blocks old, as a return of a single coin
  (one input, one output). It is a way back for an unconverted payment, not a way to collect BCH.

A receiver that keeps BCH, or lets the campaign owner choose between BCH and the stablecoin, would be a new contract or a
variant of the landing contract, with its own tests, recovery card and measured runs. The landing contract bytecode is
fixed for this entry, and the address of a landing stays unique through the `rateDen` nonce only.

Separately, the "What already exists" list on `/how` and in the README had no line on BCH Bull. We read its own pages on
2026-11-17: https://bchbull.com/ and https://bchbull.com/user-guide. They describe a non-custodial web application that
creates AnyHedge contracts on the BCH main chain, funded in BCH, to hedge BCH against USD and other assets or to go
long or short on BCH. They do not mention CashTokens or a stablecoin token.

## Decision

- Not built: no campaign receiver and no change to `contracts/landing.cash`.
- If it is built later, it is a separate contract with its own artifact and tests, not an edit of the landing contract.
- `how.exists.bchbull` (every language) and the README list say what BCH Bull's own site describes and how Sampan
  differs (Sampan trades BCH for a token you hold; it does not hedge). No claim of use, support or any relationship.
  `how.exists.checked` now names both dates.

## Rollback

Delete the `how.exists.bchbull` line from `HowPage.tsx` and the README; the key can stay in the language files.
