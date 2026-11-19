// The eight slides of the event deck, in the order and with the titles of the event's "Widget Factory" template
// (docs/decisions/0070-event-deck-pdf.md). Every number here must appear in docs/MEASURED.md, config/sampan.json or the
// README business-model block that scripts/business-model.ts makes from config: tests/deck.test.ts checks it.
// Transaction ids are rows of docs/MEASURED.md. Text only; tools/deck/html.ts lays it out.

export interface Slide {
  /** The template's slide title (kept, so the deck reads as the template asks). */
  title: string;
  /** Large line under the title, optional. */
  lead?: string;
  /** Bullet points. */
  points?: string[];
  /** Small lines at the foot of the slide: links and sources. */
  foot?: string[];
  /** Title-style slide: the title is the product name, set large. */
  cover?: boolean;
}

export interface DeckFacts {
  siteUrl: string;
  repoUrl: string;
  tokenAddress: string;
}

const host = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function slides(f: DeckFacts): Slide[] {
  return [
    {
      title: 'Sampan',
      cover: true,
      lead: 'Dollar stablecoins in and out of Bitcoin Cash, signed in your own wallet.',
      foot: [host(f.siteUrl), 'Aiman Malib, Sasa Teguh (Malaysia). Solo.'],
    },
    {
      title: 'Sampan',
      lead: 'Stablecoins in and out of Bitcoin Cash.',
      points: [
        'Swap BCH and PUSD through Cauldron pools, in one transaction your own wallet signs.',
        'A landing address: pay BCH to it from any wallet and it reaches your address as PUSD.',
        'Send PUSD out as USDC or USDT on other chains, and bring them in, through THORChain.',
      ],
      foot: [host(f.repoUrl)],
    },
    {
      title: 'Try it in a minute',
      lead: host(f.siteUrl),
      points: [
        'Press Connect wallet and pair Selene, Paytaca or Cashonize through WizardConnect.',
        'Swap on BCH: 0.001 BCH to PUSD, read the request in your wallet and approve it.',
        'Bring in: pay 0.001 BCH to your landing address from any wallet. It arrives as PUSD.',
        'Judge path on the live site, measured: 14.2 s on an iPhone 13 and 13.6 s on a desktop, 3 page actions + 3 wallet actions.',
      ],
      foot: ['Judging? The judging guide in the repository walks the same steps with transaction ids.'],
    },
    {
      title: 'The Story of Sampan',
      lead: 'Someone finishes a job and wants to get paid in dollars on BCH from any wallet.',
      points: [
        'They send the client one Sampan address. The client pays it like any BCH address, from the wallet they already have.',
        '0.001 BCH paid to a landing address arrived as 0.20 PUSD at the owner\'s address: median 3.0 s over the three runs of 2026-11-15.',
        'On the live site, watched on an iPhone 13 browser: 3.1 s from payment to arrival.',
        'A client holding USDC on BNB Smart Chain sent 1.6 USDC to the same kind of address. It arrived as PUSD in 63.0 s.',
      ],
      foot: [
        'a9ceff4389d276597f2c6e958c01f31d580ad4573191ea2c17f7e7142400f0b7 (live site)',
        '3265f9b3269a28cd6dfefad986375f85a671122418d37e25890aee5e32051e0b (from BNB Smart Chain)',
      ],
    },
    {
      title: 'Benefits of Sampan',
      points: [
        'Landing address: median 3.0 s from payment to PUSD; 3.1 s on the live site.',
        'Any BCH wallet can pay it: Paytaca on an iPhone paid one as a plain payment, converted the same way.',
        'Wallets checked: Cashonize web, Selene web, Paytaca and Selene on an iPhone. Selene web paired in 5 of 5 tries with no retry.',
        'Send out: 2 PUSD to USDC on BNB Smart Chain in 115.9 s, to USDT in 98.4 s.',
        'Bring in through a landing address: 1.6 USDT from BNB Smart Chain in 48.4 s.',
        'If the pools cannot meet the minimum rate, the contract returns the BCH to the owner after 6 blocks.',
      ],
      foot: ['Every run, including the failures, is a row of the measurements file in the repository.'],
    },
    {
      title: 'BCH Usage',
      points: [
        'Every action is a Bitcoin Cash mainnet transaction, listed with its id in the measurements file in the repository.',
        'PUSD is a CashToken; the Cauldron pools are traded inside the transaction the wallet signs.',
        'The landing contract is CashScript (contracts/landing.cash): its BCH can leave as PUSD to the owner or back to the owner as BCH, and nowhere else.',
        'WizardConnect pairs BCH wallets; the page checks what the server built before the wallet signs.',
        'A recovery card and a public finisher script finish a landing with no Sampan server.',
      ],
    },
    {
      title: 'The Vision for Sampan',
      points: [
        'For: people in Southeast Asia holding USDT who want dollars on BCH; people paid in BCH who want part kept in dollars.',
        'BCH traded across all markets in 24 hours: USD 61,029,720 (CoinGecko API, read 2026-11-16).',
        'Value locked in Cauldron pools on BCH: USD 991,821 (DefiLlama API, read 2026-11-16).',
        'Revenue: a swap fee (business.feeBps, one output, measured once at 30 bps locally) and a route affiliate fee (thorchain.affiliateBps); landing addresses carry no fee. Both set in config, no code.',
        'Scenario, arithmetic, not a forecast: 1 % of that daily BCH volume at 30 bps = USD 1,831 per day.',
        'Sampan Pay: a spread (pay.spreadBps, 0 live) keeps the BCH left after buying the invoice\'s PUSD; measured once locally at 50 bps (merchant 0.20 PUSD, 1331 sats to the fee address); BitPay lists 2 % + USD 0.25 per transaction (bitpay.com/pricing, read 2026-11-16).',
        'Today: fee 0, hackathon limits.',
      ],
    },
    {
      title: 'Thank you',
      cover: true,
      points: [f.siteUrl, f.repoUrl, `CashTokens address: ${f.tokenAddress}`],
      foot: ['Produced with Claude Code under my direction.'],
    },
  ];
}

/** The template's titles in its order; the deck keeps them (tests/deck.test.ts). */
export const TEMPLATE_TITLES = [
  'Sampan',
  'Sampan',
  'Try it in a minute',
  'The Story of Sampan',
  'Benefits of Sampan',
  'BCH Usage',
  'The Vision for Sampan',
  'Thank you',
] as const;
