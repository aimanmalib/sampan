# 0038 Atomic swap route: a byte copy of its client, behind a flag

Date: 2026-11-17

## Context

USDC on Base and PUSD on Bitcoin Cash can also be swapped without THORChain: the `sampan-atom` repository runs hash
time-locked swaps against one maker, with an AtomLock contract on Base and a lock script on BCH. Its
`docs/INTEGRATION.md` (commit `1b6c6f704993a81b726b19dd4f51b9f1e97979e8`) describes how another site can offer that
route: one self-contained ES module built from a named commit, the maker API under `/atom/api` on the same host, and a
check of `GET /atom/api/health` against the contract address in the built client before the route is shown.

Sampan should be able to show both routes side by side and let the user choose. Sampan's own rule is that it writes no
hash-locked contract or script of its own: `contracts/` holds only the landing contract. The atomic swap contracts,
their tests and their measured swaps stay in their own repository.

## Decision

- The client is a byte copy, not copied source. `web/public/vendor/atom-client-1b6c6f7.js` is the output of
  `npm run build:client` from `git archive 1b6c6f704993a81b726b19dd4f51b9f1e97979e8` unpacked into an empty temporary
  folder (`npm ci --ignore-scripts`, Node 22.23.5). It was built twice from two fresh folders; both builds gave
  sha256 `19a5a7e862f950e1550d79823d471c4e81b1834be3550d73317a13ef374ede19` (1,661,545 bytes), so the copy can be
  rebuilt and compared by anyone with that commit. No other file of that repository is copied.
- The file name carries the short commit. A new client means a new commit, a new file name and a new hash in config,
  so no cache holds an old build under the same URL.
- `config/sampan.json` names the file (`atom.clientUrl`), the commit, the sha256, the AtomLock address
  (`0x195748691cBD8f47794d03f2992Bc988314af7C3`), the API path, the flows offered, the health timeout, the quote pause,
  the poll interval and the origins the client connects to (`atom.connect`). `features.atom` is false and `atom.flows` is
  empty until a swap through Sampan's own page has been measured on mainnet.
- While `features.atom` is false the page loads nothing from the route: `web/src/atom/load.ts` returns before any
  `import()`, and the Content Security Policy does not list the client's Electrum servers or Base RPCs. Only while it is
  true are the `atom.connect` origins added to `connect-src`.
- Before the route is shown, `web/src/atom/health.ts` asks `{apiPath}/health` and requires `ok` true, `mainnet` true,
  the `chainId` of the built client, and an `atomLock` equal (ignoring letter case) to both the built client's address
  and `atom.atomLock`. Any other answer, no answer within `atom.healthTimeoutMs`, or a client that fails to load leaves
  the route out, writes one `console.info` line with a short code, and the THORChain route works as before.

## Evidence read from the chains

The maker repository's `docs/MEASURED.md` lists three mainnet swaps. Read on 2026-11-17 (Base receipts through
`https://mainnet.base.org`, BCH transactions through Electrum `bch.imaginary.cash` at height 977696):

| Swap | Base | Base receipt | BCH | BCH |
|---|---|---|---|---|
| usdc-to-pusd claim | `0xf6c003bf4513885d3e133905430380cd982c8abdd25aba85611edbbcd61def7e` | status 1, block 58224326, to the AtomLock | `a66680ca309ab1741befa82dd1ca469f22a39f8161b6cfc1a64bf95a8a307eed` | 79 confirmations, mined 2026-11-16 13:20 UTC |
| pusd-to-usdc claim | `0x021c30513042acad46ebd5651e93693ef77cde58abeabd8c677f6cd8d05dc266` | status 1, block 58235357, to the AtomLock | `9cdbbbb512be3852dae0ab9925abd3034749bd53c437d9746e7c6aa5061aafce` | 74 confirmations, mined 2026-11-16 14:22 UTC |
| refund | `0xf8b0964c169e42d133bd24e87346750be1a3f3793b3d73d8a4d2ba087f988f1c` | status 1, block 58307735, to the AtomLock | `93370b529a1117ec77f2571ee3e076319390a52a7865c8cbacb443236aabe267` | 71 confirmations, mined 2026-11-16 14:36 UTC |

These are the maker repository's evidence. They are not copied into Sampan's `docs/MEASURED.md`; a swap through
Sampan's page is recorded there as its own Runs row before any flow is listed in `atom.flows`.

## Consequences

- `tests/atom-config.test.ts` checks that the file's sha256 equals `atom.clientSha256`, that the file contains
  `atom.atomLock`, that `atom.connect` covers every Electrum server and Base RPC the built client uses, and that the
  policy lists none of them while the flag is off. `tests/atom-health.test.ts` covers each way the route is hidden.
- The 1.6 MB file is served as a static file but never requested while the flag is off.
- Undo: set `features.atom` to false (the shipped value) and deploy; removing the route entirely is deleting the
  vendor file, `web/src/atom/`, the `atom` config block and this record.
