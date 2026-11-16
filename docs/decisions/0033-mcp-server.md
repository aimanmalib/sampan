# 0033. An MCP server for AI agents, as a thin client that checks the address itself

Date: 2026-11-16. Status: accepted.

## Context

People increasingly ask an AI agent to do a task for them. An agent can already call the Sampan API, but it would have to
learn the endpoints and, for a landing address, it would have to trust the address the server sends. The web page does not
trust it: it recomputes the address from the recovery card. An agent should get the same check without writing it.

## Decision

- `mcp/` holds a Model Context Protocol server over stdio built with the official `@modelcontextprotocol/sdk` (MIT) and
  `zod` input schemas. `mcp/tools.ts` has the handlers with `fetch` passed in; `mcp/register.ts` declares the tools;
  `mcp/server.ts` starts it. Start command: `npm --prefix <repo> run --silent mcp` (`--silent` keeps npm's banner off
  stdout, which carries the protocol only; logs go to stderr).
- Tools: `quote_swap` (`POST /api/swap/quote`, read only, decimal amounts in and out), `create_landing_address`
  (`POST /api/land/open`, then the card is read with `acceptCard` from `core/client/land.ts`, the code the page uses: the
  address must equal the one recomputed from the card, the card must pay the owner asked for, for the token and wait the
  site config states, on the same network; otherwise the tool returns an error and no address), `get_crossing_status`
  (`GET /api/crossings/:id`, read only) and `create_invoice` (`POST /api/pay/invoice`), listed only when `GET /api/config`
  says `features.pay` is on when the server starts.
- The site is `SAMPAN_URL` or `site.url` in `config/sampan.json`; no URL is written in the code.
- No private key, seed, signing code or test wallet in `mcp/`. Every tool that leads to a payment says the user pays or
  signs in their own wallet.
- The SDK and `zod` are development dependencies: the production image runs `npm prune --omit=dev` and never loads `mcp/`.
  The SDK brings an HTTP stack (express, hono) for its other transports; only stdio is used here. It installed without
  `--legacy-peer-deps` on npm 10 with vitest 5.1.
- Tests (`mcp/tools.test.ts`) use the SDK `Client` with an in-memory transport over a fake `fetch`, and one test starts the
  server with the README command from another folder against a local HTTP stub and talks to it over stdio.

## Consequences

- An agent gets the same refusal the page gives when a server sends an address that does not belong to the owner.
- `create_invoice` does not recompute the invoice address: the invoice reply carries no card. The tool only checks that the
  payment link and the address agree.
- Undo: delete `mcp/`, the `mcp` script, the two development dependencies and the README section. Nothing else imports it.
