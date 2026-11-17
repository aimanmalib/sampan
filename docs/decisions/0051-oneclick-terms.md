# 0051: 1Click sections in /terms and /risks

Date: 2026-11-18. Status: accepted. Follows ADR 0048 (pre-check and how each term is met), ADR 0049 (server module)
and ADR 0050 (route row). No deploy; `features.oneClick` stays false, so the live pages are unchanged except for the
operator name and the date.

## Context

The 1ClickSwap API terms (docs.near-intents.org/security-compliance/terms-of-service.md, "Last Updated: October 7,
2026", read again on 2026-11-17 at 23:20 UTC) ask the developer to keep end-user terms that cover section 4.2 (a) to
(i), to show the section 4.6 UK disclosure, and to disclose the compliance controls of section 10.5. ADR 0048 said
which slice adds these and that the operator name changes in that slice.

## Decision

- A section in `legal.terms` or `legal.risks` can carry `oneClick: true`; it is shown only while `features.oneClick`
  is true (`web/src/legal/sections.ts`, the same rule style as `cross`). The rule is unit tested
  (`tests/legal-sections.test.ts`) and the 1Click fake server shows it in `e2e/legal.spec.ts`.
- `/terms` gets a section `oneclick`: who carries out the crossing, then one list item per term: release from all
  liability (4.2(a)), no warranty (4.2(b)), irreversible transactions with network fees, slippage, bridging and
  cross-chain risks (4.2(c)), wallet and chain risks borne by the person (4.2(d)), no use by sanctioned persons or from
  restricted places (4.2(e), 9.1), no promise of price, execution or uptime (4.2(f), 14.2), no contract or rights
  against Intents Technology (4.2(g)), compliance controls that can delay, block or hold a crossing (10.5), and nothing
  said on their behalf (4.2(i)). 4.2(h) is a duty to add text when asked and has no text of its own today.
- The 4.6 UK disclosure is kept word for word. A section can name one `verbatim` part: every language shows that part
  in English, marked `lang="en"`, and the translation under it with a "Translation:" label. The sentence that leads to
  it is translated.
- The text says "does not promise" where the terms say "does not guarantee": the meaning is the same and the site's
  text check refuses "guarantee" and "secure" in English page text. The UK sentences contain neither word.
- `/risks` gets a section `oneclick`: a refused quote, a pause or an unfilled deposit, compliance holds, and bridged
  tokens; the funds line says an unfilled deposit goes back to the refund address in the quote, which is the person's
  own address (ADR 0049), less fees.
- `legal.operator` becomes "Sasa Teguh (SASA TEGUH DIGITAL SOLUTION, Malaysia)" for the whole of `/terms`, and
  `legal.updated` moves to 18 November 2026 in every language.
- Restricted places: section 9.1 leaves the list to "a separate access or compliance policy". The Risk and
  Compliance page (docs.near-intents.org/security-compliance/risk-and-compliance.md) and the Security page, read on
  2026-11-17 at 23:20 UTC, name no country. `compliance.blockedCountries` stays as it is; nothing is guessed. It is
  read again before the route is shown.
- `docs/OPERATIONS.md` gets a section on incidents that touch 1Click (4.5): the owner is told with the facts, the owner
  tells Intents Technology within 24 hours, and no public statement is made by an agent.

## Consequences

- Turning `features.oneClick` on shows the 1Click terms and risks in every language at once; no text has to be
  added at that point. The project gate refuses a 1Click flag without the UK words and the operator name.
- A new language needs the `terms.oneclick.*` and `risks.oneclick.*` keys like every other section; the language
  test checks list items and the verbatim part too.
- To roll back: remove the two `oneclick` entries from `config/sampan.json`.
