# 0010 Landing addresses on the server and the page

Date: 2026-11-15. Status: accepted.

## Context

Flow L needs the server to open landing addresses, finish them without a key, and report their progress; the page needs a
Bring in tab, a payment from the connected wallet, and a status page that carries the recovery card.

## Decisions

- **Minimum rate from the worst case.** `POST /api/land/open` prices `limits.localMinSats` minus `landing.convertFeeSats` and
  `landing.tokenDustSats` on the current pools, lowers it by `landing.toleranceBpsDirect`, and sets
  `rateNum = floor(tokensMin * 1e8 / minSats)`. Larger payments meet the rate more easily because the fixed costs are spread.
  The same owner on unchanged pools gets the same address back (same crossing, no duplicate row).
- **The page recomputes the address.** The server returns the recovery card; `core/client/land.ts` reads it (the address must
  match its parameters) and also requires the owner, token and wait to equal what the page asked for. A mismatch shows an error
  and no address.
- **Paying from the connected wallet** is a plain payment (`core/tx/payment.ts`, shared with the test wallet). The page checks
  it with `checkTransaction`: one deposit output of exactly the amount shown to the landing lock the page computed, everything
  else back to the wallet, fee under the cap. `/api/broadcast` accepts a landing payment while the address is open and leaves
  the landing status to the finisher.
- **In-process finisher.** `server/landing/watcher.ts` subscribes each watched address with
  `blockchain.scripthash.subscribe` (subscriptions are renewed on every new Electrum connection), polls every
  `landing.pollSeconds` as the fallback, and runs `finishLanding` once per address at a time with `landing.finishAttempts`
  rebuilds when a pool moves. Watching resumes from the `landings` table after a restart; an address quiet for
  `landing.idleDays` stops being watched. A waiting status page calls `POST /api/crossings/:id/kick` every
  `landing.pagePollSeconds`.
- **Columns are added, tables are never rebuilt.** New `landings` columns (`seen_at`, `finished_at`, `last_activity`) are added
  with `ALTER TABLE ... ADD COLUMN` when missing.
- **Stats.** `GET /api/stats` returns completed, returned and lost counts and the median seconds from a coin being seen to it
  being converted, split by `origin` (`test` for the project's own wallet). Swaps are not counted as crossings.
- **Recovery card in the fragment.** The status link is `/c/<id>#card=<base64url JSON>`; the fragment never reaches the server
  and the page checks it like any card before showing or offering it for download.
- **Payment QR** is drawn as an SVG path from `qrcode-generator` (MIT) in byte mode, so the BIP21 link is exact and no logo
  covers it.
- **Closed until measured.** The landing endpoints answer 404 `flow_closed` and the tab is hidden while `features.landing` is
  off; the e2e run starts a second fake server with it on.

## Undo

Switch `features.landing` off: the tab and endpoints close; the finisher keeps finishing addresses already opened.
