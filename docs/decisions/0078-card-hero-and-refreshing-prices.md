# 0078: Card hero with live status chips, and prices that refresh themselves

Date: 2026-11-20. Status: accepted.

## Context

A visitor should see in five seconds what Sampan does and that it is working: the headline, then a real action card
with a real price. The earlier top (ADR 0071) put a longer sentence between the headline and the card, and a price
was asked once per input, so a page left open showed a price that could be minutes old with nothing saying so.

## Decision

- `config.ui.hero` picks the top: `card` (shipped) or `phone` (the ADR 0071 top, the way back, no rebuild of code).
  With `card` the headline (`hero.title`, seven words) is followed by status chips, the boat picture, the judge strip
  and the card; the longer sentence (`hero.sub.*`) moves under the card.
- Status chips (`web/src/HeroChips.tsx`, `core/hero-chips.ts`): one per chain a crossing reaches, `open` or `paused`,
  read from the same network rows the Send out and Bring in panels list (`/api/health` through `networkStatus`), so a
  paused chain is shown as paused and never hidden; the PUSD dollar price from the peg reading and the number of
  Cauldron pools counted (`/api/depth`). A reading that is missing draws no chip (no zeros, no guesses).
- `config.quote.autoRefreshMs` (shipped 5000; 0 = off; else 2000 to 60000): one page-wide ticker
  (`web/src/quote/refresh.ts`) makes the shown price ask again in Swap, Send out and Bring in. It counts only while the
  tab is visible and no modal dialog is open (`dialog[open]` or `aria-modal="true"`), and not while a swap or crossing
  is being signed, so a price never changes under a wallet prompt. Back on the tab, a price older than one period asks
  at once. There is no refresh button.
- `web/src/quote/useLiveQuote.ts` is the one request hook behind the three panels (the three copies it replaces
  differed only in the request). A refresh that fails keeps the last good price; its "Updated Ns ago" line keeps
  counting, so the age stays honest. The visible count is hidden from screen readers; a polite live region says
  "Price updated at <time>" once per new price.
- Send out and Bring in refresh both route quotes they compare (THORChain and, when offered, 1Click); with the
  shipped rate limit of 30 quotes a minute per visitor that is at most 24 a minute while both are shown.
- Motion: none added. Chips are static, colour and type come from theme tokens, no `filter` or `backdrop-filter`.
- Tests: the e2e fake servers set `autoRefreshMs` to 0 so the flow specs see one quote per input; `e2e/hero.spec.ts`
  runs against the shipped-config server with Playwright's fake clock (first screen, chips, the age line changing with
  no click, no requests while hidden or while a dialog is open).

## Way back

`ui.hero: "phone"` restores the earlier top; `quote.autoRefreshMs: 0` stops the refresh. Both are config only.
