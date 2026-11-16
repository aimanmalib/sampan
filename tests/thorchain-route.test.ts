// Route B against the fake THORNode (frozen mainnet captures): quotes, limits, status and failover. No network.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeThornode } from '../server/routes/fake.js';
import { ThorchainRoute } from '../server/routes/thorchain.js';
import { Thornode, ThornodeError, type HttpGet } from '../server/routes/thornode.js';
import { RouteError } from '../server/routes/types.js';

const dir = path.resolve('tests/fixtures/thorchain');
const NOW = 1_794_770_000_000;
const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const ASSET = 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913';
const route = (get: HttpGet = fakeThornode(dir, () => NOW), now = NOW) =>
  new ThorchainRoute({ node: new Thornode(['https://a.example', 'https://b.example'], get, 1000), slippageBps: 150, minSatsPerByte: 1n, now: () => now });

describe('THORChain route', () => {
  it('quotes out with the vault as a cash address, our limit in the memo and the recommended fee rate', async () => {
    const q = await route().quoteOut({ sats: 1_000_000n, asset: ASSET, destination: DEST });
    expect(q.vault).toMatch(/^bitcoincash:q/);
    expect(q.minOut).toBe((q.expectedOut * 9850n) / 10000n);
    expect(q.memo).toBe(`=:BASE.USDC:${DEST}:${q.minOut}`);
    expect(q.satsPerByte).toBe(3n);
    expect(q.recommendedMinSats > 0n).toBe(true);
    expect(q.expiry * 1000).toBeGreaterThan(NOW);
  });

  it('quotes in to a BCH address without its prefix and returns the router plan', async () => {
    const r = route();
    const q = await r.quoteIn({ asset: ASSET, amount: 500_000_000n, destination: 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt' });
    expect(q.destination).toBe('qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt');
    expect(q.memo.split(':').slice(2)).toEqual(['qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt', q.minSats.toString()]);
    expect(r.buildIn(q)).toMatchObject({ kind: 'router-deposit', router: q.router, vault: q.vault, amount: 500_000_000n });
  });

  it('refuses a quote that has already expired', async () => {
    await expect(route(fakeThornode(dir, () => NOW - 3_600_000)).quoteOut({ sats: 1_000_000n, asset: ASSET, destination: DEST })).rejects.toThrow(/expired/);
  });

  it('maps THORChain stages to unseen, done (with the destination txid) and refunded', async () => {
    const r = route();
    expect(await r.status(`${'ab'.repeat(31)}00`)).toEqual({ stage: 'unseen' });
    const done = await r.status('ab'.repeat(32));
    expect(done).toEqual({ stage: 'done', outTxid: 'C0'.repeat(32), outChain: 'BASE' });
    const fake = fakeThornode(dir, () => NOW);
    const refunding: HttpGet = async (url, t) => {
      const res = await fake(url, t);
      const body = res.body as { planned_out_txs: Array<{ refund: boolean }> };
      return { status: 200, body: { ...body, planned_out_txs: body.planned_out_txs.map((p) => ({ ...p, refund: true })) } };
    };
    expect((await route(refunding).status('ab'.repeat(32))).stage).toBe('refunded');
  });

  it('asks THORNode for an EVM hash without its 0x prefix', async () => {
    const fake = fakeThornode(dir, () => NOW);
    const asked: string[] = [];
    const spy: HttpGet = async (url, t) => (asked.push(url), fake(url, t));
    expect((await route(spy).status(`0x${'ab'.repeat(32)}`)).stage).toBe('done');
    expect(asked[0]).toMatch(new RegExp(`/thorchain/tx/status/${'AB'.repeat(32)}$`));
  });

  it('fails over to the next node when one does not answer, and stops on a THORChain refusal', async () => {
    const fake = fakeThornode(dir, () => NOW);
    const seen: string[] = [];
    const flaky: HttpGet = async (url, t) => {
      seen.push(new URL(url).host);
      if (url.startsWith('https://a.example')) throw new Error('timeout');
      return fake(url, t);
    };
    await route(flaky).quoteOut({ sats: 1_000_000n, asset: ASSET, destination: DEST });
    expect(seen).toEqual(['a.example', 'b.example']);
    const refuse: HttpGet = async () => ({ status: 400, body: { message: 'amount less than dust threshold' } });
    await expect(new Thornode(['https://a.example', 'https://b.example'], refuse).request('/x')).rejects.toMatchObject({ unreachable: false });
    await expect(route(refuse).quoteOut({ sats: 1n, asset: ASSET, destination: DEST })).rejects.toBeInstanceOf(RouteError);
    const down: HttpGet = async () => {
      throw new Error('down');
    };
    await expect(new Thornode(['https://a.example'], down).request('/x')).rejects.toBeInstanceOf(ThornodeError);
  });

  it('is open only while BCH and the destination chain trade', async () => {
    expect(await route().open(['BASE'])).toBe(true);
    const fake = fakeThornode(dir, () => NOW);
    const halted: HttpGet = async (url, t) => {
      const res = await fake(url, t);
      return { status: 200, body: (res.body as Array<{ chain: string }>).map((r) => (r.chain === 'BCH' ? { ...r, halted: true } : r)) };
    };
    expect(await route(halted).open(['BASE'])).toBe(false);
    expect(await route().open(['ETH'])).toBe(false);
  });
});
