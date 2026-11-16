# 0015 A Malay translation of the README

Date: 2026-11-16. Status: accepted.

## Context

The repository keeps everything it tracks in English; Malay appears in `lang/ms.json` so the page can be read in both
languages. That rule keeps working notes and code readable for judges and outside readers. The README is different: it is the
public front page of the project, and the product itself is bilingual. The event is not English-only.

## Decision

- `README.md` stays complete and in English, and is the reference text.
- `README.ms.md` is a faithful Malay translation of it, with the same header, images of the Malay page
  (`docs/images/home-ms-*.png`), and a link back. Its opening line says the English version applies when the two differ.
- Both READMEs link to each other within their first lines. `tests/readme.test.ts` checks the links and that every local
  file or image either README points to exists.
- No other tracked file is written in Malay. Internal notes stay out of the repository.

## Undo

Delete `README.ms.md` and the `README.ms.md` link in the README header. Nothing else depends on it.
