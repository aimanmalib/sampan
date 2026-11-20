// A measured run counts as ok only once its Bitcoin Cash transactions are known to the network, not when a page or
// the server says it is done: a broadcast that one server accepted can still be dropped when another spend of the
// same pool coin reaches the miners first (ADR 0080). Every BCH transaction id of a run must be found (mempool or
// block) on at least `min` of the configured Electrum servers; otherwise the row is written as a failure.
import { ElectrumChain } from '../../server/chain/electrum.js';
import type { Run } from './runs.js';

export type Found = 'found' | 'missing' | 'down';
export type Lookup = (server: string, txid: string) => Promise<Found>;

export interface SeenOptions {
  servers: string[];
  /** Servers that must know the transaction. */
  min: number;
  /** Rounds of asking, and the wait between them (a fresh broadcast takes a moment to reach every server). */
  tries: number;
  waitMs: number;
  lookup: Lookup;
  sleep?: (ms: number) => Promise<void>;
}

/** Defaults of the measuring tools; each tool can take --seen-min, --seen-tries and --seen-wait-ms. */
export const SEEN_DEFAULTS = { min: 2, tries: 6, waitMs: 5000 } as const;

const BCH_ID = /(?:^|[^0-9a-fx])([0-9a-f]{64})(?![0-9a-f])/gi;

/** The Bitcoin Cash transaction ids in a Runs txid cell: a plain id, or `bch … · avax 0x… · convert …` (EVM hashes skipped). */
export function bchTxids(cell: string | undefined): string[] {
  if (!cell) return [];
  const out = new Set<string>();
  for (const m of cell.matchAll(BCH_ID)) out.add(m[1]!.toLowerCase());
  return [...out];
}

/** Asks every server until `min` of them know the transaction or the tries run out. */
export async function seenBy(txid: string, o: SeenOptions): Promise<{ seen: string[]; missing: string[]; down: string[] }> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last = { seen: [] as string[], missing: [] as string[], down: [] as string[] };
  for (let i = 0; i < Math.max(1, o.tries); i++) {
    if (i > 0) await sleep(o.waitMs);
    const answers = await Promise.all(o.servers.map(async (s) => [s, await o.lookup(s, txid).catch((): Found => 'down')] as const));
    last = {
      seen: answers.filter(([, a]) => a === 'found').map(([s]) => s),
      missing: answers.filter(([, a]) => a === 'missing').map(([s]) => s),
      down: answers.filter(([, a]) => a === 'down').map(([s]) => s),
    };
    if (last.seen.length >= o.min) return last;
  }
  return last;
}

/** The run as it should be written: an ok run whose BCH transaction is not seen by enough servers becomes a failure. */
export async function checkRun(run: Run, o: SeenOptions): Promise<Run> {
  if (!run.ok) return run;
  for (const txid of bchTxids(run.txid)) {
    const r = await seenBy(txid, o);
    if (r.seen.length < o.min) {
      const note = `broadcast dropped: ${txid.slice(0, 8)} seen by ${r.seen.length} of ${o.servers.length} servers`;
      return { ...run, ok: false, note };
    }
  }
  return run;
}

/** One connection per server, asked with blockchain.transaction.get. */
export function electrumLookup(timeoutMs = 10_000): { lookup: Lookup; close: () => Promise<void> } {
  const clients = new Map<string, ElectrumChain>();
  const client = (s: string): ElectrumChain => {
    let c = clients.get(s);
    if (!c) clients.set(s, (c = new ElectrumChain([s], { timeoutMs })));
    return c;
  };
  return {
    lookup: async (s, txid) => ((await client(s).transaction(txid)) ? 'found' : 'missing'),
    close: async () => {
      await Promise.all([...clients.values()].map((c) => c.close().catch(() => undefined)));
    },
  };
}
