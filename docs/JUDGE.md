# Judging Sampan

A walk through the live site at <https://sampan.sasateguh.com>, from watching a run to signing your own mainnet
transaction. Every transaction id below is a row of [the measurements file](MEASURED.md).

## 1. Open the site

The "Judging?" steps start open: on a phone right under the card, on a wide screen beside the picture.
"Fill this in for me" opens Bring in with 0.001 BCH, the amount the steps name.

## 2. Watch it run, no wallet

While the replay is switched on (`features.watchDemo`), the judge box links to `/watch?dir=land`. It replays one
measured landing with play money, and each step links its real transaction:
`a9ceff4389d276597f2c6e958c01f31d580ad4573191ea2c17f7e7142400f0b7` ([Runs](MEASURED.md#runs), plain payment on the
live site, watched in WebKit on an iPhone 13).

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
