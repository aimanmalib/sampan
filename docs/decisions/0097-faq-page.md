# 0097: Questions page and custody steps

Date: 2026-11-22

## Decision

- `/faq` is a client page like `/how`; the server already answers every extension-less path with the page, so no server route
  or feature flag is added.
- Which questions are asked, in which order, comes from `config.faq.items`; who holds the funds at each step comes from
  `config.faq.custody`. A step marked `cross` is shown only while cross-chain flows are open, the same rule `/terms` and `/risks` use.
- Answers fill their numbers from config (token symbol and name, `landing.returnAfterBlocks`, `business.feeBps`), so a config
  change cannot leave the page stating an old value.
- There is no `docs/SECURITY.md` yet, so the custody section links to `/risks`, which already says what happens to funds in each case.

## Way back

Remove the footer and `/how` links and the `faq` block; nothing else reads it.
