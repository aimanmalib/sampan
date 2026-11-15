# 0008 Landing contract, recovery card and finisher

Date: 2026-11-15. Status: accepted.

## Context

Flow L pays BCH from any wallet or exchange to a contract address that can only pay the owner: tokens at or above a minimum
rate (`convert`), or the BCH itself after a number of blocks (`giveBack`). Anyone must be able to check the address and finish a
landing without the Sampan server.

## Decisions

- **CashScript 0.14.** `contracts/landing.cash` follows the specified logic; the relative age is `this.age` (the 0.14 name).
  The compiled artifact `contracts/landing.json` is committed (`npm run contracts:build`); a test compiles the source again and
  compares. Address type P2SH20.
- **One address computation without CashScript.** `core/landing.ts` builds the redeem script from the artifact with libauth only,
  so the page can recompute the address without bundling CashScript (it needs a newer libauth than the rest of the code). Tests
  compare it with CashScript's own address. `scripts/verify-landing.ts` uses the other path: it compiles the source with `cashc`
  and derives the address with CashScript, then compares it with the card.
- **Category byte order.** Cards and config hold the category as explorers show it; the contract parameter is the reverse
  (transaction byte order). A test shows that the explorer order makes `convert` fail.
- **Recovery card.** JSON `kind: sampan-landing`, `version: 1`, network, address, owner address and full locking bytecode,
  category, token label, `rateNum`/`rateDen` as decimal strings, `returnAfter`, creation time. A reader recomputes the address and
  rejects a card that does not match its own parameters.
- **Unused satoshis stay with the owner.** Cauldron pools trade whole token units, so a trade cannot always use every satoshi of
  the coin. The convert transaction puts what the trade leaves (after the exact fee) on the owner's token output instead of
  leaving it to miners. The contract does not restrict that value. The fee is the measured size at `fees.satsPerByte`.
- **giveBack sequence.** The landing input carries `returnAfter` as its sequence (BIP68 blocks) in a version 2 transaction; the
  default final sequence disables the lock and fails, as a test shows.
- **Finisher logic in one place.** `server/landing/finish.ts` lists the coins at the address, converts with fresh pools (up to
  five attempts when a pool moves before broadcast), otherwise returns the coin once it is old enough, and checks every
  transaction in the VM before it is sent. Coins carrying tokens are left alone. `scripts/finisher.ts` runs it from a card against
  public Electrum servers and the public Cauldron indexer; the server's own finisher will reuse it.
