# 0024 Business model numbers come from config, the scenario from a script

Date: 2026-11-16

## Context

The README describes who Sampan is for and how it could earn. Numbers typed by hand drift from their source and
cannot be checked, and a revenue estimate presented as a plan would claim more than anyone knows.

## Decision

- `business.sources` in `config/sampan.json` holds 2 or 3 public numbers, each with the URL it was read from and
  the day it was read (`read`, YYYY-MM-DD). Config validation refuses a source without an https URL and a date,
  a key used twice, and a scenario source whose value is not a number.
- One source is marked `scenario: true`: a flow per day (BCH traded across all markets in 24 hours). Stocks such as
  a total supply or the value locked in pools are context only; a share of a stock is not a fee base.
- `scripts/business-model.ts` (`npm run business-model`) prints the sources table and the scenario table
  (value x share x `scenarioBps`), labelled "arithmetic, not a forecast". `--write` replaces the block between two
  markers in README.md. `tests/business-model.test.ts` fails when README.md and config disagree, so a re-read
  number reaches the README only through the script.
- The numbers read on 2026-11-16: CoinGecko (BCH 24 h volume), DefiLlama (Cauldron value locked, USDT in circulation).
  Re-reading them means editing `value` and `read`, then running the script with `--write`.

## Consequences

The fee settings stay 0 during the event; the table shows what a fee would be at a share of a public number,
nothing more. Rollback: delete the README block and the `sources` entries; nothing else reads them.
