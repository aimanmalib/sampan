// Builds the MCP server: one tool per handler in tools.ts, with input schemas. create_invoice is listed only when
// the site has Sampan Pay switched on (features.pay in GET /api/config, read once at start).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createInvoice, createLandingAddress, getCrossingStatus, quoteSwap, ToolFailure, type Deps, type SiteConfig } from './tools.js';

const SIGN_NOTE = 'This server holds no private key and never signs: the user pays or signs in their own wallet.';

type Result = { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

async function answer(run: () => Promise<Record<string, unknown>>): Promise<Result> {
  try {
    const out = await run();
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
  } catch (e) {
    if (e instanceof ToolFailure) return { content: [{ type: 'text', text: e.message }], isError: true };
    throw e;
  }
}

export function buildServer(d: Deps, cfg: SiteConfig, version: string): McpServer {
  const server = new McpServer({ name: 'sampan', version });
  const tokens = Object.keys(cfg.tokens);
  const token = z.string().regex(/^[A-Za-z]{2,10}$/).optional().describe(`Token symbol, one of ${tokens.join(', ')}. Default ${cfg.defaultToken}.`);
  const address = z.string().min(20).max(120);

  server.registerTool(
    'quote_swap',
    {
      title: 'Quote a BCH and stablecoin swap',
      description: `Price a swap between BCH and a dollar stablecoin in the Cauldron pools, as the Sampan site would. Buy = pay BCH, get the token; sell = pay the token, get BCH. ${SIGN_NOTE}`,
      inputSchema: {
        side: z.enum(['buy', 'sell']),
        amount: z.string().regex(/^[0-9]*\.?[0-9]+$/).describe('Decimal amount the user pays: BCH for buy, the token for sell, e.g. "0.001".'),
        token,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (i) => answer(() => quoteSwap(d, cfg, i)),
  );

  server.registerTool(
    'create_landing_address',
    {
      title: 'Open a landing address',
      description: `Open a landing address for an owner: BCH sent there from any wallet is converted to the stablecoin for that owner, or given back. The address is recomputed locally from the recovery card and refused if it differs or pays someone else. Returns the address, a status page link and the card. ${SIGN_NOTE}`,
      inputSchema: {
        ownerAddress: address.describe('The owner\'s Bitcoin Cash address (cashaddr) that receives the tokens or the BCH back.'),
        token,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (i) => answer(() => createLandingAddress(d, cfg, i)),
  );

  server.registerTool(
    'get_crossing_status',
    {
      title: 'Read a crossing status',
      description: 'Read what the Sampan status page shows for a landing, swap or crossing id: its status and transaction ids.',
      inputSchema: { id: z.string().regex(/^[0-9a-f]{32}$/).describe('Crossing id, 32 lowercase hex characters.') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (i) => answer(() => getCrossingStatus(d, i)),
  );

  if (cfg.features.pay) {
    server.registerTool(
      'create_invoice',
      {
        title: 'Create a Sampan Pay invoice',
        description: `Create a payment request in US dollars for a merchant: the customer pays BCH and the merchant address receives the stablecoin. ${SIGN_NOTE}`,
        inputSchema: {
          usd: z.number().positive().describe('Amount in US dollars.'),
          merchantAddress: address.describe('The merchant\'s Bitcoin Cash address (cashaddr) that receives the stablecoin.'),
          orderId: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/).optional(),
          returnUrl: z.string().url().optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      (i) => answer(() => createInvoice(d, i)),
    );
  }
  return server;
}
