# 0034 Languages come from config

Date: 2026-11-16

## Context

The page had a two-state button that swapped English and Malay. More languages are planned, and adding one should
not mean editing the top bar, the i18n module or the tests.

## Decision

- `config.i18n` holds `default` and `languages` (`{ code, name }`, menu order, each name in its own language). It
  reaches the page through `GET /api/config`. Validation requires `en` in the list (every key falls back to it), no
  code twice, and a default from the list.
- Every `lang/<code>.json` is bundled; a file alone offers nothing. A language is shown only when config lists it and
  its file exists. Until the config arrives the menu holds the shown language only.
- The button became a native `<select>` in the same place (phones show their own list). Its font size is 16 px so
  iOS does not zoom the page on focus, and its chevron is drawn with CSS gradients so no image is needed.
- The choice is kept in `localStorage` as `sampan.lang`. An unknown or no longer offered code shows the config
  default, which is not saved, so a later config change still applies. There is no browser language detection: the
  page a judge opens is the same every time.
- One parity test runs over every `lang/*.json`: the English keys exactly, no empty string, the same placeholders.

## Rollback

Remove a language from `config.i18n.languages`; its file can stay.
