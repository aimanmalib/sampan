// Recomputes a landing address from its recovery card and the contract source, without the Sampan server.
// Usage: npx tsx scripts/verify-landing.ts <card.json>
// Checks, in order: the card is well formed; contracts/landing.cash compiles to the committed artifact; CashScript
// (compiling from source) and Sampan's own code derive the same P2SH20 address; that address is the card's.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hexToBin } from '@bitauth/libauth';
import { compileFile } from 'cashc';
import { Contract, ElectrumNetworkProvider } from 'cashscript';
import artifact from '../contracts/landing.json' with { type: 'json' };
import { categoryToScriptOrder } from '../core/landing.js';
import { readCard, type LandingCard } from '../core/landing-card.js';

const SOURCE = fileURLToPath(new URL('../contracts/landing.cash', import.meta.url));

export interface Verdict {
  ok: boolean;
  lines: string[];
}

/** Address CashScript derives from a freshly compiled source; independent of core/landing.ts. */
export function addressFromSource(card: LandingCard): string {
  const compiled = compileFile(SOURCE);
  const provider = new ElectrumNetworkProvider(card.network, { manualConnectionManagement: true });
  const args = [hexToBin(card.ownerLockHex), categoryToScriptOrder(card.category), BigInt(card.rateNum), BigInt(card.rateDen), BigInt(card.returnAfter)];
  return new Contract(compiled, args, { provider, contractType: 'p2sh20' }).address;
}

export function verifyCard(raw: unknown): Verdict {
  const read = readCard(raw);
  if (typeof read === 'string') return { ok: false, lines: [`card rejected: ${read}`] };
  const { card } = read;
  const lines = [`card address:        ${card.address}`, `owner:               ${card.ownerAddress}`];
  const compiled = compileFile(SOURCE);
  if (compiled.bytecode !== artifact.bytecode) return { ok: false, lines: [...lines, 'contracts/landing.json does not match contracts/landing.cash'] };
  lines.push('source compiles to the committed artifact');
  const fromSource = addressFromSource(card);
  lines.push(`from source (cashc): ${fromSource}`);
  if (fromSource !== card.address) return { ok: false, lines: [...lines, 'MISMATCH: the card does not describe this contract'] };
  lines.push(`minimum: ${card.rateNum} ${card.token} base units per ${card.rateDen} sats; BCH returnable after ${card.returnAfter} blocks`);
  return { ok: true, lines: [...lines, 'OK: the address is the landing contract with these parameters'] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npx tsx scripts/verify-landing.ts <card.json>');
    process.exit(2);
  }
  const verdict = verifyCard(JSON.parse(readFileSync(file, 'utf8')));
  for (const l of verdict.lines) console.log(l);
  process.exit(verdict.ok ? 0 : 1);
}
