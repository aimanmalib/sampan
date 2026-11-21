# 0090: Wallet balance in the top bar

Status: accepted, 2026-11-21

## Context

Once a BCH wallet is connected, its balance was only visible inside the Swap tab. Someone moving between tabs or
pages could not see what the wallet holds without going back to Swap.

## Decision

- A small pill at the right of the top bar, beside the language menu, shows BCH and each offered stablecoin (PUSD, and
  MUSD while `features.musd` is on). It reads the same wallet scan the panels use (`wallet.view`); there is no new
  server call.
- It is hidden until a wallet is connected and scanned.
- It updates after every transaction (the panels already call `wallet.refresh()`) and every `wallet.balancePollMs`
  (30 s shipped, 0 = after transactions only) while the tab is visible and no dialog is open, so a wallet prompt never
  sees its coins change underneath it. The server's scan cache (`wallet.scanCacheSeconds`) bounds the extra load.
- BCH is rounded down to `wallet.balanceBchDecimals` (5 shipped), so the pill never shows more than the wallet holds;
  the Swap tab keeps the full figure.
- A click on the front page opens the Swap tab and moves focus to it: that is where the full balance and Disconnect
  already live, so there is no second wallet panel. On other pages the pill is a link to the front page.
- The pill is a column of one line per asset, so it stays narrow, and its numbers are never cut short. When the pill
  and the language menu do not fit beside the wordmark, the pill moves to a second line under the menu, still at the
  top right (`flex-wrap: wrap-reverse`). The menu is as wide as its longest language name, so on phones (320 px and an
  iPhone 13) the pill takes that second line; on wider screens it sits in the top row before the menu. A first attempt
  that let the pill shrink in one row showed "0.01..." at 320 px, which is why it wraps instead.
- Behind `features.headerBalance`; turning it off removes the pill and its polling.

## Consequences

The first screen is unchanged before a wallet connects; after connecting on a phone the page is one pill line taller. Rounding down hides sub-unit dust in the pill only.
