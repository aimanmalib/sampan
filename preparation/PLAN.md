# Sampan: plan written before any code existed

**Sampan: plan written on 11 November 2026 and revised on the evening of 14 November 2026, when BCH BLAZE 2026 started, before any
code existed. No code existed before 14 November 2026 14:00 UTC.**

Problem. Dollars on Bitcoin Cash are PUSD and MUSD. The dollars most people already hold are USDT and USDC on other chains, or BCH
on an exchange. On 10 November 2026, getting from one to the other took a cross-chain swap to BCH in one app and then a second swap
to the stablecoin in another. Token balances could not be sent into a cross-chain route directly, and the user needed BCH for fees.

Product. One screen with three tabs.
1. Swap on BCH: BCH to PUSD or back through existing Cauldron pools, one WizardConnect signature.
2. Bring in. First, a landing address: BCH sent to it from any wallet or exchange lands in a small pay-to-script-hash contract with
   two public paths: convert it to at least a minimum amount of PUSD and pay the owner, or after a few blocks give the BCH back to
   the owner. Neither path needs a signature and neither can pay anyone else. A keyless watcher finishes the conversion; anyone can
   do the same with the public recovery card. Second, USDC or USDT on another chain: the user connects the wallet they already use
   there, and the BCH that comes across lands in the same contract.
3. Send out: PUSD or BCH to USDC or USDT on another chain. The PUSD is swapped in Cauldron pools and handed to the cross-chain
   route. The user does not need BCH for fees.

Decisions.
- The route between chains is an existing provider: THORChain, or NEAR Intents if the entrant accepts its API terms. The choice is
  recorded in docs/decisions.
- The server holds no keys. It builds unsigned transactions; the page checks each one against the quote before the wallet sees it,
  and every Bitcoin Cash transaction is validated in the libauth virtual machine before signing or broadcast.
- Stablecoin on BCH: PUSD first. Other side: USDC and USDT, Base first.
- Limits: USD 0.50 to 250 per crossing during the hackathon. Sampan charges no fee.
- Public numbers come from measured mainnet runs recorded in docs/MEASURED.md.
- Everything in the repository is in English. License: MIT.
- A separate repository holds an XO template for a swap offer (fill or cancel), run on chipnet, with its invitations and a journal
  of what happened while building it.

Gates. Local swap on mainnet by 16 November. Landing address by 17 November. Open to outside testers from 18 November. Sending
out by 18 November. Bringing in from another
chain by 19 November. XO template by 21 November. Feature freeze on 21 November 12:00 Malaysia time. Submission on 21 or 22 November.

Out of scope. Custody, own liquidity, fees, other tokens, accounts, a native app.

Honest limits. The crossing between chains depends on a third party. If the price moves more than the tolerance while BCH is on
its way in, the owner receives BCH. Cross-chain swaps for BCH already exist in other apps; what this adds is the stablecoin as the
start and end point, sending out without holding BCH for fees, and the landing address.

AI disclosure. The research, design and code are produced with Claude Code under the entrant's direction.
