# 0035 Indonesian and Filipino, translated with software

Date: 2026-11-17

## Context

ADR 0034 made the language list a config value. Indonesian and Filipino are the next two. No speaker of either
language has checked the text yet, and a visitor should know that.

## Decision

- `lang/id.json` and `lang/fil.json` were drafted from `lang/en.json` (not from Malay) with an AI model. Product and
  network names, placeholders and the event name stay as in English. One term per idea: "alamat pendaratan" in
  Indonesian, "landing address" kept in English in Filipino, as Filipino apps usually keep such terms.
- Check: a different model translated each file back to English without seeing the English file, then every key was
  compared with the English meaning, and the differences were fixed. The text is machine translated, checked by back
  translation, and not yet reviewed by a native speaker.
- `config.i18n.languages[].machine: true` marks such a language. While it is shown, the footer says, in that language,
  "Translated with software. Corrections welcome." (`lang.machine`).
- On `/terms` and `/risks`, every language other than English adds "If a translation differs, the English text
  applies." in that language (`legal.translation`).
- The static error page shows the languages config offers, in its order (it read English and Malay only before).
- The first screen and the accessibility checks run once per offered language, on a phone and on desktop, so longer
  Filipino text cannot push the primary button off the first screen or shrink a target.
- A speaker's correction replaces the text and turns `machine` off for that language.

## Rollback

Remove `id` or `fil` from `config.i18n.languages`; the files can stay.
