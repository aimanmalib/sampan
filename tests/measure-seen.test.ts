// A run is ok only when its BCH transactions are known to enough Electrum servers (ADR 0080): a page that says
// "done" for a broadcast the network later dropped must not become an ok row in docs/MEASURED.md.
import { describe, expect, it } from 'vitest';
import type { Run } from '../tools/measure/runs.js';
import { bchTxids, checkRun, seenBy, type Found, type SeenOptions } from '../tools/measure/seen.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const SERVERS = ['wss://one.test:50004', 'wss://two.test:50004', 'wss://three.test:50004'];

/** Each server's answers for each txid, one per round (the last repeats). */
const opts = (answers: Record<string, Record<string, Found[]>>, extra: Partial<SeenOptions> = {}): SeenOptions & { asked: number } => {
  const round = new Map<string, number>();
  const o = {
    servers: SERVERS,
    min: 2,
    tries: 3,
    waitMs: 0,
    asked: 0,
    sleep: async () => undefined,
    lookup: async (s: string, t: string): Promise<Found> => {
      o.asked++;
      const key = `${s} ${t}`;
      const i = round.get(key) ?? 0;
      round.set(key, i + 1);
      const list = answers[s]?.[t] ?? ['missing'];
      return list[Math.min(i, list.length - 1)]!;
    },
    ...extra,
  };
  return o;
};

const run = (txid: string, ok = true): Run => ({ utc: new Date(0), flow: 'swap', amount: '0.001 BCH', txid, seconds: 2, ok });

describe('seen by the network', () => {
  it('reads the BCH ids of a crossing cell and skips the EVM hash', () => {
    expect(bchTxids(`bch ${A} · avax 0x${B} · convert ${C}`)).toEqual([A, C]);
    expect(bchTxids(A.toUpperCase())).toEqual([A]);
    expect(bchTxids(undefined)).toEqual([]);
  });

  it('keeps an ok run whose transaction two servers know', async () => {
    const o = opts({ [SERVERS[0]!]: { [A]: ['found'] }, [SERVERS[2]!]: { [A]: ['found'] } });
    expect(await checkRun(run(A), o)).toEqual(run(A));
  });

  it('turns a run into a failure when its transaction was dropped (the page said done, no server knows it)', async () => {
    const o = opts({});
    const out = await checkRun(run(A), o);
    expect(out.ok).toBe(false);
    expect(out.note).toBe(`broadcast dropped: ${A.slice(0, 8)} seen by 0 of 3 servers`);
    expect(out.txid).toBe(A);
  });

  it('one server is not enough, and a server that is down does not count', async () => {
    const o = opts({ [SERVERS[0]!]: { [A]: ['found'] }, [SERVERS[1]!]: { [A]: ['down'] } });
    expect((await checkRun(run(A), o)).ok).toBe(false);
  });

  it('a crossing fails when its conversion is dropped even though the arriving BCH is on chain', async () => {
    const o = opts({ [SERVERS[0]!]: { [A]: ['found'] }, [SERVERS[1]!]: { [A]: ['found'] } });
    const out = await checkRun(run(`bch ${A} · avax 0x${B} · convert ${C}`), o);
    expect(out.ok).toBe(false);
    expect(out.note).toContain(C.slice(0, 8));
  });

  it('asks again while a fresh broadcast reaches the servers, and stops once enough know it', async () => {
    const o = opts({ [SERVERS[0]!]: { [A]: ['missing', 'found'] }, [SERVERS[1]!]: { [A]: ['missing', 'missing', 'found'] } });
    const r = await seenBy(A, o);
    expect(r.seen).toEqual([SERVERS[0], SERVERS[1]]);
    expect(o.asked).toBe(9);
  });

  it('leaves failed runs alone without asking', async () => {
    const o = opts({});
    expect(await checkRun(run(A, false), o)).toEqual(run(A, false));
    expect(o.asked).toBe(0);
  });
});
