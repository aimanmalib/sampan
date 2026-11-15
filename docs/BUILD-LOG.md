# Build log

One line per step, newest last.

- 2026-11-14: Repository skeleton: README, MIT license, AGENTS.md, the pre-code plan in `preparation/PLAN.md`.
- 2026-11-14: Entry registered for the event; the submission materials folder is set up locally and kept out of the repository.
- 2026-11-14: Code scaffold: config with validation, English and Malay text files, Fastify server with strict headers, front page skeleton, unit and browser tests, gate script, Dockerfile.
- 2026-11-14: Front page fits the phone first screen: shortened copyable address in the banner, compact mobile layout, 44 px touch targets, browser test checks the primary button is visible without scrolling.
- 2026-11-14: Test wallet key tool (secrets only in the ignored env file, addresses printed), single-container deploy with rollback and a browser check against the public URL, uptime watch.
- 2026-11-14: The Build with XO bounty work is started as a separate repository with its own build plan; this repository does not depend on it.
- 2026-11-14: Core swap pieces: pool v0 locking bytecode and arithmetic checked against cashlab on captured pools, swap transaction builder, VM verification with 2026 rules, browser-side transaction check (rules 1 to 5) with sabotage tests.
- 2026-11-14: Token categories in config are case-insensitive and lowercased on load; the pool fixture reads the PUSD category from config instead of repeating it.
- 2026-11-14: Server swap API: Electrum client with failover over four checked Fulcrum servers, Cauldron pool discovery verified against the chain, fresh pools before each build, wallet scan with gap limit, quote, build and broadcast endpoints, SQLite crossings, rate limits behind the proxy, offline fake network.
- 2026-11-14: Page swap tab: WizardConnect session with an own pairing dialog, wallet scan from xpubs, quote, build, browser-written expectation checked before signing, broadcast with rebuild, status page, headless test wallet with budget, offline e2e in Chromium and WebKit (flow flagged off until measured).
- 2026-11-15: Measured mainnet swaps through the page and the headless test wallet; pool locks rebuilt from owner_pkh match the chain; broadcast waits for the Electrum index; test wallet sells fixed; swap tab switched on.
- 2026-11-15: Cashonize web signed both swap directions on mainnet through the page; wallet scan cache cut to 30 seconds; test wallet can pay plain BCH within its budget.
- 2026-11-15: Landing contract (convert and giveBack) with its compiled artifact, address computed in core and checked against CashScript, recovery card, verify-landing and finisher scripts, contract tests on the mock network.
- 2026-11-15: Page text and tabs follow the flow flags: one hero and description text per flag combination, no USDT, no fee-free claim, closed flows have no tab.
- 2026-11-15: Landing addresses end to end on the fake network: open with a worst-case minimum rate, page recomputes the address, pay from the connected wallet, in-process finisher (subscription, polling, restart, idle stop), status page with boat and recovery card, judge strip, stats endpoint; flow still switched off.
- 2026-11-15: Judge strip moved onto the first screen: left column under the picture on wide screens, compact strip above the card on phones (picture moves below the card), steps folded under the strip title; e2e checks the strip and the primary button above the fold on iPhone 13 and 1440x900.
- 2026-11-15: First screen holds headline, picture with both banks, full judge strip, tabs and one primary button in EN and BM on iPhone 13, 1440x900 and 1280x720, also after Fill (e2e/first-screen.spec.ts, red on c73f438): hero sub follows the card on phones, landing promise under the button, scene sky cropped, balanced two-line headline; ADR 0011.
- 2026-11-15: G2 on mainnet: three landings converted to PUSD at the owner (one paid through WizardConnect, two plain payments; median 3.0 s from payment to conversion) and one giveBack by the public finisher after a refused conversion (docs/MEASURED.md); Bring in tab switched on and deployed.
- 2026-11-15: Link preview: Open Graph and Twitter tags filled at build time from lang and config, 1200x630 PNG (44 KB) drawn from the page's sampan picture by `npm run og-image`, cache key from content; ADR 0012.
- 2026-11-15: Route B (THORChain) behind one Route interface, fixture-tested THORNode client with node failover, our own limit in the memo, the 3-output deposit and checkTransaction rule 6; Send out tab (two signatures from PUSD) and its status page, hidden while cross-chain is off; ADR 0013.
