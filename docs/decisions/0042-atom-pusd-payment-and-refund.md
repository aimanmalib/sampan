# 0042: PUSD to USDC on the atomic route, and the refund button

Date: 2026-11-17

## Context

ADR 0040 left Send out's atom row with a disabled button, and the Bring in run (USDC to PUSD) had no way back for a
user whose swap stopped. For PUSD to USDC the swap client's `paymentRequest` names what the user's BCH wallet must
send: one output to the contract's token-aware P2SH32 address carrying the PUSD amount plus enough BCH for the
contract's own claim or refund fee. Sampan's BCH wallets (WizardConnect) only sign; Sampan always builds the
transaction itself. They already sign transactions whose outputs go to P2SH32 scripts (every Cauldron swap pays the
pool's P2SH32 contract back), so paying the swap contract is the same kind of request for the wallet.

## Decision

- The page builds the payment from the scanned wallet coins (`core/tx/token-payment.ts`): coins of the PUSD
  category first, then plain coins for the BCH and the fee; other token categories and NFTs are never spent; token
  change goes back to the wallet with the token dust, BCH change likewise.
- Before the wallet is asked, `checkTransaction` checks it against the request. A deposit in the expectation may now
  name a token: the contract output must carry exactly that fungible amount of that category, and no other output
  may pay anyone but the wallet. A contract payment receives nothing, so its expectation has no `receive`; rule 4 is
  skipped only then. The contract address must be a token-aware P2SH32 address on the wallet's network.
- The server relays the signed payment through `POST /api/atom/broadcast`. It is open only while `features.atom`
  is true and `atom.flows` lists `pusd-to-usdc`, is rate limited like a crossing, accepts only a transaction with
  exactly one P2SH32 output carrying the route stablecoin and plain P2PKH outputs otherwise, and runs the libauth VM
  against the coins the page names before sending. It builds nothing and keeps no record: the swap is the
  service's, and the recovery card is the user's record.
- The payment button, like the lock button, works only after this swap's recovery card was downloaded.
- Refund, both ways: while a swap is not final, once the service's time to lock has passed, every poll asks the
  client whether the chain's clock is past the user's lock timeout (`refundReady`; a failed read counts as not yet).
  Only then "Get my funds back" shows. It asks the service's relay (`refundByRelay`); when the relay fails and the
  lock is on Base with a connected EVM wallet, the wallet sends the refund itself (`refundWithWallet`). A BCH lock has
  no wallet fallback in the page; the recovery card still holds what is needed.
- The poll no longer stops on a maker problem, only on a final state, so the refund can still appear.
- `atom.flows` still lists nothing on the live site. `pusd-to-usdc` joins it only after a measured mainnet run
  through this page.

## Rollback

Remove `pusd-to-usdc` from `atom.flows` (or set `features.atom` false): the row, the payment step and the relay
endpoint all close with it.
