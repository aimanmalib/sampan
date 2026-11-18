# 0057: Three look directions as themes, icon chips, and a score to compare them

Date: 2026-11-18. Status: accepted.

## Context

ADR 0056 put every colour, font and spacing value behind theme tokens, with `paper` as the only theme. The next step
is to try three new looks on the same page and pick one by measurement, without changing any flow, API or text.
Each look has to pass the same rules as `paper`: no colour-contrast failure (WCAG AA), the whole card on the first
phone screen in every language, no filter or backdrop-filter anywhere (WebKit), fonts served from the site itself.

## Decision

- Three themes, each one file of tokens plus a few named overrides in `web/src/themes/`:
  - `night` (A): a dark page with a still radial gradient, Manrope for headings and text, one card with a deep
    shadow, a teal action colour.
  - `linen` (B): the paper look grown up: a light ground, Fraunces for headings and for numbers (the amount and the
    price line), one card with a soft shadow.
  - `ink` (C): a green-ink ground with one amber lamp for the action and the selected tab, IBM Plex Sans at high
    contrast.
  `config.ui.themes` lists all four; `config.ui.theme` stays `paper`. The two dark themes redefine the colour tokens
  inside the event banner so it keeps light text on a band darker than the page, and keep QR codes dark on white.
- Manrope comes from the npm package `@fontsource-variable/manrope` 5.3.0 (SIL Open Font License 1.1, text beside
  the files), Latin and Latin Extended subsets, copied into `web/src/fonts/` like the fonts of ADR 0055. A theme
  names at most two families plus the mono face.
- Icon chips. Token and chain names in the amount row and in the network picker show an icon. The icons are the
  colour SVGs of `cryptocurrency-icons` 0.18.1 (CC0-1.0, licence beside the files in `web/src/icons/`): BCH, USDC,
  USDT, ETH, BNB, AVAX, TRX. Which name gets which file is `config.ui.icons` (token symbol or chain key → file
  name); a name without an entry, such as PUSD or Base, gets a one-letter monogram. The icon is decoration
  (`alt=""`); the name stays the text. The same markup serves every theme.
- Dollar value. Under the unit of the amount, inside the amount row's existing height, the page shows "≈ $x" from
  numbers it already has: on Swap, the quote's token amount when buying the token and the amount itself when selling
  it; on Send out, the amount when it is paid in the token. PUSD counts as one US dollar. It is formatted with
  `Intl.NumberFormat` in the visitor's language, so it adds no text to the language files. There is no new API call.
  It sits under the unit rather than under the amount because on a phone the amount label is hidden and a new line
  would push the card past the first screen.
- The server writes the running config's `ui.theme` into `<html data-theme>` when it serves the page (the build
  writes the same name already). A server started with a config patch, such as a local preview of another theme,
  then serves that look without a rebuild.
- `E2E_THEME=<name>` starts every fake server of the browser tests in that look; the gate runs the first-screen,
  accessibility and front-page specs once more for each listed theme other than the shipped one.
- `tools/design/score.ts` scores the three directions on the built server with the real config and the real
  network: axe colour contrast on `/` and `/how` in every language and both engines, the first-screen rule on an
  iPhone 13 in every language, the words on the first English phone screen, and a five-second test (a fresh model
  session reading only the phone screenshot, or a mechanical proxy that is the same for all three). `tools/design/
  rank.ts` orders them: qualifies first (contrast and first screen), then the five-second score, then fewer words,
  then A, B, C. Results stay on the host, not in the repository.

## Consequences

- Going back is `ui.theme: "paper"` and a deploy; `paper` cannot be removed from the list.
- After one direction is chosen, the two others are removed from `web/src/themes/` and from `ui.themes`; their files
  stay in the history.
- Adding an icon is one SVG file and one `ui.icons` entry; a unit test checks that every entry names a file.
