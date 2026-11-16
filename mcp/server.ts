// Sampan MCP server over stdio. The site is SAMPAN_URL, or site.url in config/sampan.json. stdout carries the
// protocol only; every log line goes to stderr. Run: npm --prefix <repo> run --silent mcp
import { readFileSync } from 'node:fs';
import { env } from 'node:process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './register.js';
import { baseUrl, readSiteConfig, type Deps } from './tools.js';

const root = new URL('../', import.meta.url);
const read = (file: string): { site?: { url?: string }; version?: string } => JSON.parse(readFileSync(new URL(file, root), 'utf8'));

async function main(): Promise<void> {
  const deps: Deps = { base: baseUrl(env.SAMPAN_URL, read('config/sampan.json').site?.url ?? ''), fetch: globalThis.fetch };
  const cfg = await readSiteConfig(deps);
  const server = buildServer(deps, cfg, read('package.json').version ?? '0.0.0');
  await server.connect(new StdioServerTransport());
  process.stderr.write(`sampan mcp: serving ${deps.base}${cfg.features.pay ? ' (with create_invoice)' : ''}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`sampan mcp: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
