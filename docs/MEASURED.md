# Measured

## Runs

| UTC | flow | amount | txid | seconds | result |
|---|---|---|---|---|---|
| 2026-11-15T12:38:16Z | swap | 0.001 BCH to at least 0.19 PUSD | 3ab8f28d873185c1206eb558d31692d2aa2d3ac22d10813ef9cb03d016af6f26 | 1.4 | ok |
| 2026-11-15T12:51:14Z | swap | 0.001 BCH to at least 0.19 PUSD | a7dc452a9225a43f6d8565a6560cf0e19d79f0cd38a354f6d2006afc4287605e | 2.6 | ok |
| 2026-11-15T12:51:17Z | swap | 0.4 PUSD to at least 0.00188825 BCH | - | 0.8 | fail (Your wallet did not sign. Nothing was sent.) |
| 2026-11-15T12:52:08Z | swap | 0.001 BCH to at least 0.19 PUSD | 4178ec6e73e9babe0932a1efd3fb249e505ccd135e63af2e47cf6143e82ddbeb | 3.4 | ok |
| 2026-11-15T12:52:12Z | swap | 0.6 PUSD to at least 0.00283237 BCH | - | 1.4 | fail (Your wallet did not sign. Nothing was sent.) |
| 2026-11-15T12:53:30Z | swap | 0.001 BCH to at least 0.19 PUSD | 18f728af257d3a9f90a8b91ab61a05a4a7d219bf5bb5dbc3722f52150e59d98b | 3.5 | ok |
| 2026-11-15T12:53:36Z | swap | 0.8 PUSD to at least 0.00377648 BCH | f2ba7ddd2712927e339d7294ef1d95ad4814245896643380bb2ed14fc82359be | 2.9 | ok |
| 2026-11-15T12:53:39Z | swap | 0.001 BCH to at least 0.19 PUSD | c5a9641d388051aeedccc918e27d7a71e25b880e36f8ea68380a280f19eed14d | 1.9 | ok |
| 2026-11-15T12:53:44Z | swap | 0.2 PUSD to at least 0.00094412 BCH | 348a19cf7c15fb1751cb76746539db2bee6cce3091f84dd99066c9b94419e064 | 1.9 | ok |
| 2026-11-15T12:53:48Z | swap | 0.001 BCH to at least 0.19 PUSD | 796c730ded97cf41ee144c60270bde7a70adc4fd84ce4999ef600af5124c04a4 | 3.0 | ok |
| 2026-11-15T12:55:44Z | swap | 0.001 BCH to at least 0.19 PUSD | cc419c612d7ae9474c8e1b33585a5dcc55d968db2f6e83ecee3d95aecc154da2 | 2.4 | ok |
| 2026-11-15T12:55:50Z | swap | 0.4 PUSD to at least 0.00188821 BCH | 35b4f68d212b93df1089951cd998115dbf708a046b323a0b3b479c27911c92d4 | 2.9 | ok |
| 2026-11-15T12:55:55Z | swap | 0.001 BCH to at least 0.19 PUSD | 11ab321b49204daad4187444e07b1d0e000fdc8281cfcfa68716f83fda7575fe | 2.9 | ok |
| 2026-11-15T12:56:00Z | swap | 0.2 PUSD to at least 0.00094411 BCH | dd1b6c416a19acb5371674cdd5ba179d00067d625c2d1f30751d9a8771adb2df | 2.9 | ok |
| 2026-11-15T13:15:08Z | swap | 0.001 BCH to at least 0.19 PUSD (Cashonize web) | b05c33b32fc4aacd371325b8fb9c73b7067ef030c20b3b5d4d6d84adcd221a50 | - | ok |
| 2026-11-15T13:16:02Z | swap | 0.2 PUSD to at least 0.00094423 BCH (Cashonize web) | 26f9aab0dc21774ab687e0f3a9ceb04fd3d03d7b0501e73190064c44eecc4398 | 2.8 | ok |

Rows are written by `tools/measure/swap.ts`: the built server against mainnet, the real page in Chromium, and the
headless test wallet (`tools/test-wallet`) paired through the page's own WizardConnect link. `seconds` runs from
pressing Swap to the page showing the broadcast transaction. Rows marked "Cashonize web" were signed by a fresh
Cashonize web wallet (cashonize.com) in an automated browser instead of the test wallet; the first of them has no
time because the script paused before pressing Sign.

### Notes on failed runs

- 2026-11-15 12:51 and 12:52 (PUSD to BCH): the test wallet refused to sign, as designed when its own check
  fails. Cause: its policy lowercased the `BCH` receive marker into a token id, so a sell could never pass rule 4.
  Fixed with a regression test; nothing was sent. The page's own check had passed.
- Before those rows, a stale wallet balance after a swap was traced to the Electrum server answering the broadcast
  before its index listed the new outputs. The server now waits for the index (`electrum.indexWaitMs`) before it
  answers the broadcast.
- During the Cashonize check, a wallet funded after its first scan still showed 0 BCH on the next connect: the
  server kept the empty result for its 10 minute scan cache. The cache is now 30 seconds (`wallet.scanCacheSeconds`,
  at most 60 by config validation).

## Pool locks rebuilt from owner_pkh

`npx tsx tools/measure/pools.ts 3`, checked 2026-11-15T12:34:35Z against https://indexer.cauldron.quest and
Electrum. The locking bytecode rebuilt from the pool v0 template holds the outpoint the indexer names, with the
same BCH and token amounts.

| owner_pkh | pool outpoint | sats | token units | rebuilt lock holds it |
|---|---|---|---|---|
| 12effae58abba049d5402634a709e1e6a15c0480 | ae49768d4cf86cd0a8e90b642127f7cfb8e965e5479aec5c71e07f60f4faffd4:4 | 25076353619 | 5269656 | match |
| ab0de1203d427481b247faa0b434af9fd49a3ee8 | ae49768d4cf86cd0a8e90b642127f7cfb8e965e5479aec5c71e07f60f4faffd4:5 | 7098735328 | 1491761 | match |
| 2ceb9595368b37469a883092dfa02b79f31ec538 | ae49768d4cf86cd0a8e90b642127f7cfb8e965e5479aec5c71e07f60f4faffd4:7 | 6030646363 | 1267307 | match |

## Wallets checked

| Wallet | How | Result |
|---|---|---|
| Sampan test wallet (`@wizardconnect/wallet` 0.2.4, headless) | mainnet, paired through the page | 12 swaps broadcast (table above) |
| Cashonize web (cashonize.com, 2026-11-15) | fresh wallet in automated Chromium, link pasted in its Connect tab | paired, xpubs shared, coins found; showed the page's one-sentence prompt and the balance change; signed both directions (2 swaps above) |
