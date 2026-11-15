// Fake THORNode for SAMPAN_FAKE=1 and tests: answers from frozen mainnet captures (tests/fixtures/thorchain),
// with the destination written into the memo, the output scaled to the requested amount and a fresh expiry.
// No network.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { HttpGet } from './thornode.js';

const read = (dir: string, name: string): Record<string, unknown> => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as Record<string, unknown>;

/** Amount the out capture was taken for (satoshis), and the in capture (1e8 units). */
const OUT_AMOUNT = 1_000_000n;
const IN_AMOUNT = 500_000_000n;

export function fakeThornode(dir = path.resolve('tests/fixtures/thorchain'), now: () => number = Date.now): HttpGet {
  const out = read(dir, 'quote-out.json');
  const into = read(dir, 'quote-in.json');
  const inbound = JSON.parse(readFileSync(path.join(dir, 'inbound.json'), 'utf8')) as unknown;
  const done = read(dir, 'status-done.json');
  const unseen = read(dir, 'status-unseen.json');
  return async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/thorchain/inbound_addresses')) return { status: 200, body: inbound };
    const status = /\/thorchain\/tx\/status\/([0-9A-F]{64})$/.exec(u.pathname);
    // A txid ending in 00 has not been seen yet; any other is finished (enough for the status page).
    if (status) return { status: 200, body: status[1]!.endsWith('00') ? unseen : { ...done, tx: { ...(done.tx as object), id: status[1] } } };
    if (u.pathname.endsWith('/thorchain/quote/swap')) {
      const amount = BigInt(u.searchParams.get('amount') ?? '0');
      const dest = u.searchParams.get('destination') ?? '';
      const isOut = u.searchParams.get('from_asset') === 'BCH.BCH';
      const base = isOut ? out : into;
      const scale = (v: unknown): string => ((BigInt(String(v)) * amount) / (isOut ? OUT_AMOUNT : IN_AMOUNT)).toString();
      const memo = String(base.memo).split(':').slice(0, 2).concat(dest).join(':');
      if (amount < BigInt(String(base.recommended_min_amount_in)) / 10n)
        return { status: 400, body: { code: 3, message: 'amount less than dust threshold', details: [] } };
      return {
        status: 200,
        body: { ...base, memo, expected_amount_out: scale(base.expected_amount_out), expiry: Math.floor(now() / 1000) + 600 },
      };
    }
    return { status: 404, body: { message: 'not found' } };
  };
}
