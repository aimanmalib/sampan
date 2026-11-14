# 0004 Token categories in config are case-insensitive

Date: 2026-11-14. Status: accepted.

## Context

A token category is 32 bytes of hex and is public on chain. Generic secret scanners read a 64-character hex value stored next to a
key such as `token_id` as a possible API key, and the build checks fail on that pattern even when the value is a public identifier.

## Decisions

- `config/sampan.json` accepts token categories in upper or lower case. The loader (`normalizeConfig`) lowercases them, so the rest of
  the code and `/api/config` only ever see lowercase hex.
- The shipped config stores categories in uppercase. The captured pool fixture no longer repeats `token_id` on each pool; tests read
  the PUSD category from the shipped config, so there is one place to change it.

## Consequences

Anyone comparing a category must use the loaded config, not the raw file. Rollback: lowercase the values in the config; the loader
accepts both.
