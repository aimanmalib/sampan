# 0060: Verify a Nostr identity's BCH address in a small module of our own

Date: 2026-11-18. Status: accepted.

## Context

A payer should be able to send PUSD or BCH to a Nostr identity (an npub, an nprofile or a NIP-05 name) instead of a
pasted address, with the address proven by the identity itself. The proof format is the NIP-39 `bch` claim written up
by Tambat (https://github.com/aimanmalib/tambat, `docs/NIP-39-bch.md`, MIT): a kind 10011 event carries
`["i", "bch:<cashaddr>", "<proof>"]`, where the proof is a BCH signed message over
`Verifying that I control the following Nostr public key: <npub>` made by the address key. Anyone can check it with
the event alone. No identity server is involved, and Sampan must not add one: the check runs in the payer's browser.

Two ways to get a verifier into the page:

- A. Build Tambat's own core into a minified vendor file. That core depends on `nostr-tools` (relay pool and NIP-19)
  and on Tambat's config module, so the bundle carries a large vendor file for about 400 lines of logic.
- B. Write the few functions needed here, on libraries the repository already locks: `@bitauth/libauth` (CashAddr,
  HASH160, SHA-256), `@noble/curves` 1.9.1 (BIP-340 Schnorr verification and secp256k1 key recovery) and
  `@scure/base` 1.2.6 (bech32). Both are MIT and were already in `package-lock.json` through `viem`; they become direct
  dependencies at the same exact versions, so nothing new is downloaded.

## Decision

B. `core/nostr-id/` holds four pure modules:

- `nip19.ts`: npub, nprofile (TLV type 0 only) and 64-char hex to a public key. Relay hints in an nprofile are
  ignored: the page asks only the relays in its own config.
- `event.ts`: event shape, NIP-01 id (SHA-256 of `[0, pubkey, created_at, kind, tags, content]`), BIP-340 signature,
  and the replaceable-event order (larger `created_at`, then lower id). A relay's word is never taken for any of these.
- `claim.ts`: the `bch` claims of an event, the signed-message hash (`\x18Bitcoin Signed Message:\n`, CompactSize,
  text, SHA-256 twice), key recovery from the 65-byte proof in the encoding its header declares, and the address
  check (lowercase P2PKH with a 20-byte hash; P2SH and token-aware types are refused because a signed message proves one
  key only). The token-aware address with the same hash is derived for PUSD.
- `verify.ts`: the steps in Tambat's order and with its names (`event_shape`, `kind`, `event_id`, `nostr_sig`,
  `newest`, `bch_sig`, `address_match`, `network`, `key_separation`). The first failing step gives one reason code
  (`input_invalid`, `wrong_kind`, `id_mismatch`, `nostr_sig_invalid`, `replaced`, `not_found`, `bch_sig_invalid`,
  `address_invalid`, `wrong_signer`, `wrong_network`, `same_key`, `ambiguous`) that the page will translate. Two
  claims that both pass for different addresses are `ambiguous`; a payment never picks one of them.

Tests use Tambat's `examples/vectors.json`, copied byte for byte into `tests/fixtures/tambat-vectors.json`, with the
commit and SHA-256 recorded in `tests/fixtures/tambat-vectors.source.json`, and one real binding read from two public
relays (`tests/fixtures/nostr-owner-binding.json`). Each reason code has a mutant event signed by the vector keys (the
public BIP39 test phrase) that must fail with that code. No Tambat code is copied; only the vectors, the step names
and the claim text are shared.

## Limits

- The `newest` step needs the other events of the same author from relays. A relay can hide a newer event, so the
  page asks every relay in config and keeps the newest valid event across all of them. That lookup, NIP-05 and the
  feature flag come in the next change; this one adds no network access and nothing on the page.
- A pass proves that, when the event was signed, one holder controlled both keys. It says nothing about who that is
  or whether the keys are still held.

## Way back

The module is not reachable from the page until the feature flag exists and is on. Removing it means deleting
`core/nostr-id/` and the two direct dependencies.
