# Judging Sampan

A walk through the live site at <https://sampan.sasateguh.com>, from watching a run to signing your own mainnet
transaction. Every transaction id below is a row of [the measurements file](MEASURED.md).

<!-- bounty:start (made by scripts/bounty-table.ts from docs/bounty/stablecoin-bridge.json and docs/MEASURED.md) --><p><b>Measured on mainnet: 12 stablecoin crossings that arrived, on 3 chains (Ethereum, BNB Smart Chain and Avalanche C-Chain), in USDC and USDT; both ways on Ethereum and BNB Smart Chain.</b> Each requirement and stretch goal of the Stablecoin Bridge bounty, quoted word for word from <a href="https://bchblaze.cash/bounties/">the bounty page</a> as read on 2026-11-19 UTC. The counts come from the ok crossings in <a href="MEASURED.md"><code>docs/MEASURED.md</code></a>, made by <code>scripts/bounty-table.ts</code>.</p><table><tr><th>Requirement (quoted)</th><th>Sampan</th><th>Proof</th></tr><tr><td>Build a project that allows users to bridge or swap stablecoins into & out of BCH <sub>Requirements</sub></td><td><b>Met.</b> Send out (PUSD to another chain) and Bring in (another chain to PUSD at a landing address), signed in the user's own wallets.</td><td><a href="https://blockchair.com/bitcoin-cash/transaction/55621bde55adf3aba3bfb64fea956cd07f8f13d6a73b6c601cb40a6a1a1c14bf">newest Send out <code>bch 55621bde</code></a> · <a href="https://blockchair.com/bitcoin-cash/transaction/dde7a35b834e62ec93525e2892ab67bfcf2943ef236d03325031aa6b41e4ad88">newest Bring in <code>bch dde7a35b</code></a></td></tr><tr><td>Ie. to be able to convert stablecoins on other chains to BCH stablecoins (eg USDC on ETH into PUSD on BCH) <sub>Requirements</sub></td><td><b>Met.</b> Bring in: the stablecoin is sent to a landing address and arrives as PUSD.</td><td><a href="https://blockchair.com/bitcoin-cash/transaction/ee69844983f8798eebcf5640745a9ad382f7e223bc060c7c0cfd7d172921fea8">USDC on Ethereum to PUSD <code>bch ee698449</code></a></td></tr><tr><td>And vice-versa, BCH stables to other-chain stables (eg PUSD on BCH into USDC on ETH) <sub>Requirements</sub></td><td><b>Met.</b> Send out: PUSD is swapped and sent to the user's address on the other chain.</td><td><a href="https://blockchair.com/bitcoin-cash/transaction/fa3bdc53bf3a3d7ce25dc4f2c6fbc0c262c238141b5300fad07f720737c0f577">PUSD to USDC on Ethereum <code>bch fa3bdc53</code></a></td></tr><tr><td>A swap from BCH stables to stables in one other ecosystem is sufficient, but from BCH stables to multiple/any other ecosystems would be even better. <sub>Requirements</sub></td><td><b>Met.</b> 3 chains with an ok crossing: Ethereum, BNB Smart Chain and Avalanche C-Chain.</td><td><a href="MEASURED.md#runs">Runs table</a></td></tr><tr><td>The faster, cheaper, and easier to use the bridge is - the better. <sub>Requirements</sub></td><td><b>Partly.</b> Every crossing has its seconds and fees measured, and the cost card shows the fees before signing. No comparison with other routes is claimed.</td><td><a href="MEASURED.md#runs">seconds per crossing</a> · <a href="../core/cost.ts">cost card</a></td></tr><tr><td>On the BCH side, WizardConnect is highly recommended. <sub>Requirements</sub></td><td><b>Met.</b> BCH wallets connect with WizardConnect.</td><td><a href="../web/src/wallet/wizard.ts">WizardConnect code</a> · <a href="MEASURED.md#wallets-checked">wallets checked</a></td></tr><tr><td>On the other chain side, WalletConnect is probably essential - but it depends on the paired chains and what is popular/easiest for their wallet integration stack. <sub>Requirements</sub></td><td><b>Partly.</b> Browser wallets (EIP-6963) signed the measured crossings. A WalletConnect option is in the code; it is not counted here until it is checked on the live site.</td><td><a href="../web/src/evm/walletconnect.ts">WalletConnect code</a> · <a href="decisions/0045-walletconnect-evm.md">decision record</a></td></tr><tr><td>Project only needs to support 1 BCH stablecoin, but supporting multiple would be better <sub>Stretch goals</sub></td><td><b>Open.</b> BCH stablecoins with an ok crossing: PUSD. The MUSD pools are measured; MUSD stays off until its swaps are measured.</td><td><a href="decisions/0072-musd-pool-measurement.md">MUSD pool measurement</a></td></tr><tr><td>Contacting influential members of other ecosystems that would be willing to facilitate and promote the bridge for users of the other side of the bridge is a laudable business win. <sub>Stretch goals</sub></td><td><b>Open.</b> Not done.</td><td><a href="https://bchblaze.cash/bounties/">bounty page</a></td></tr><tr><td>Especially good would be integration or collaborations that route through large popular and existing multicoin providers like ShapeShift, ThorChain etc. <sub>Stretch goals</sub></td><td><b>Met.</b> 12 of the 12 crossings route through THORChain, using quotes from its public THORNode API. No collaboration is claimed.</td><td><a href="../server/routes/thorchain.ts">THORChain route</a> · <a href="decisions/0018-crossing-precheck-and-tracer.md">decision record</a></td></tr><tr><td>ParyonUSD is sponsoring BLAZE this year, so they are an excellent choice for first priority integration & demo purposes. <sub>Additional Notes</sub></td><td><b>Met.</b> PUSD (ParyonUSD) is the default token and the BCH stablecoin of 10 of the 12 crossings.</td><td><a href="https://blockchair.com/bitcoin-cash/transaction/55621bde55adf3aba3bfb64fea956cd07f8f13d6a73b6c601cb40a6a1a1c14bf">newest PUSD crossing <code>bch 55621bde</code></a></td></tr></table>
<!-- bounty:end -->

## 1. Open the site

The "Judging?" steps start open: on a phone right under the card, on a wide screen beside the picture.
"Fill this in for me" opens Bring in with 0.001 BCH, the amount the steps name.

## 2. Watch it run, no wallet

While the replay is switched on (`features.watchDemo`), the judge box links to `/watch?dir=land`. It replays one
measured landing with play money, and each step links its real transaction:
`a9ceff4389d276597f2c6e958c01f31d580ad4573191ea2c17f7e7142400f0b7` ([Runs](MEASURED.md#runs), plain payment on the live site, watched in WebKit on an iPhone 13).

## 3. Make your own mainnet transaction

Connect Selene, Paytaca or Cashonize with WizardConnect, then pay 0.001 BCH to your landing address. It arrives in
your wallet as PUSD. Measured the same way:
`3c04bd0a95e8432b0f36cbead20cc8aff32b017e2f88951ed7766cd02d251a79` (wallet pays through WizardConnect) and
`069a3f838227e4efcc4952466347582284b1924eba347ebaaaf00da494743e2f` (Paytaca on an iPhone). How each wallet was
checked: [Wallets checked](MEASURED.md#wallets-checked).

## 4. Check the proof table

`/how#proof` lists the newest measured runs; each id opens an explorer. A Send out and a Bring in crossing:
`ad48fa1102e1ef02869dbddc7ba6a104501e42794ff084dbfa8219e935c4e7ed` (2 PUSD to USDC on BNB Smart Chain) and
`3265f9b3269a28cd6dfefad986375f85a671122418d37e25890aee5e32051e0b` (USDC on BNB Smart Chain to PUSD, through a
landing address). Taps from the front page to an explorer page are timed with
`npx tsx tools/measure/judge-path.ts --judge-md` into [Judge path](MEASURED.md#judge-path).

## 5. Read the source

A landing address is an address of [`contracts/landing.cash`](../contracts/landing.cash): its BCH can only leave
as PUSD paid to the owner at no less than the address's minimum rate, or, after a set number of blocks, back to the
owner as BCH. [README: Run it](../README.md#run-it) runs the whole site on your machine.
