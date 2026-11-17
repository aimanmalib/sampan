// KJG2/KC2: the cost card a measured run showed, saved BEFORE the transaction is broadcast so it can later be set
// against what was really paid. Same mapping as the page (core/client/cost.ts) on the quote the run signed.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inCard, outCard } from '../../core/client/cost.js';
import type { WireInQuote } from '../../core/client/in.js';
import type { WireOutQuote } from '../../core/client/out.js';
import type { PublicConfig } from '../../core/config.js';
import type { CostCard } from '../../core/cost.js';

export interface CostShown {
  txid: string;
  flow: 'out' | 'in';
  savedUtc: string;
  card: CostCard;
}

const ID = /^(0x)?[0-9a-fA-F]{64}$/;

/** The card for this quote; throws when the quote has no named fees (no card was shown). */
export function costShown(config: PublicConfig, flow: 'out' | 'in', quote: unknown, txid: string, chainKey: string, now: Date): CostShown {
  if (!ID.test(txid)) throw new Error('--txid must be a full BCH txid or 0x EVM hash');
  let card: CostCard | null;
  if (flow === 'out') {
    const q = quote as WireOutQuote;
    card = outCard(config, q, q.source, BigInt(q.amount), []);
  } else {
    const q = quote as WireInQuote;
    const chain = config.evm.chains.find((c) => c.key === chainKey);
    if (!chain) throw new Error(`no evm.chains entry ${chainKey}`);
    card = inCard(config, q, chain, q.convert !== undefined, undefined, []);
  }
  if (!card) throw new Error('the quote has no named route fees: no card');
  return { txid, flow, savedUtc: now.toISOString(), card };
}

/** JSON with bigints as decimal strings. */
export const costJson = (c: CostShown): string => JSON.stringify(c, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2);

export function writeCostShown(dir: string, c: CostShown): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${c.txid.toLowerCase()}.json`);
  writeFileSync(file, `${costJson(c)}\n`);
  return file;
}
