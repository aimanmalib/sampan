# 0002 Test wallets and the single-container deploy

Date: 2026-11-14. Status: accepted.

## Context

Measured runs on mainnet need a wallet the tools can sign with, and the site needs a repeatable deploy with a way back.

## Decisions

- **Test wallets are generated locally by `npm run test-wallet:keys`.** Two separate 12 word BIP39 phrases (BCH mainnet and chipnet)
  and one EVM private key, written only to the ignored `.env` (mode 0600, atomic replace). The tool never prints a secret and never
  replaces an existing value, because losing a funded phrase loses the test funds. It prints the public addresses only.
- **Derivation path `m/44'/145'/0'/0/0`** (BIP44, coin type 145), the path common BCH wallets use, so the phrase can be restored in an
  ordinary wallet if a tool breaks. A unit test pins the public BIP39 test vector to its known address.
- **The production container holds no keys.** It has no env file, runs read-only as the unprivileged user, with a small CPU and memory
  limit, no published port and one external volume (`sampan-data`) so `compose down -v` cannot delete data.
- **Deploy = `deploy/deploy.sh`.** It builds the image from `git archive HEAD` (ignored files never reach the image), keeps the
  previous image in a stopped holder container for `--rollback`, installs a proxy route of its own for the one host name, retries the
  public health check, then runs the front page browser test (Chromium desktop and WebKit iPhone 13, no console errors) against the
  public URL and rolls back when it fails. Host values live in the untracked `deploy/hos.env` (template `deploy/hos.env.example`).
- **Uptime = `deploy/uptime.sh` from cron.** Two failed checks in a row send one warning, recovery sends one info line, each text at
  most once per UTC day; the text comes from the language files.

## Undo

Delete the route file and stop the container; the volume is external and stays until removed by hand.
