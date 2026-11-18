// Route B against the fake THORNode (frozen mainnet captures): quotes, limits, status and failover. No network.
import { assetsOff } from './helpers/cross-off.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import shippedJson from '../config/sampan.json' with { type: 'json' };
import type { SampanConfig } from '../core/config.js';
import { liveAssets, offered, openChoices, routeOpenFor, withLive } from '../core/route-assets.js';
import { fakeThornode } from '../server/routes/fake.js';
import { ThorchainRoute } from '../server/routes/thorchain.js';
import { Thornode, ThornodeError, type HttpGet } from '../server/routes/thornode.js';
import { RouteError } from '../server/routes/types.js';

const dir = path.resolve('tests/fixtures/thorchain');
const NOW = 1_794_770_000_000;
const shipped = shippedJson as unknown as SampanConfig;
/** THORNode inbound_addresses read on 2026-11-17 04:3x UTC: Base halted and trading paused, every other chain open. */
const inbound17 = JSON.parse(readFileSync(path.join(dir, 'inbound-2026-11-17.json'), 'utf8')) as unknown;
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

  it('maps every chain THORChain lists to open or closed from one inbound read (2026-11-17 capture: Base halted)', async () => {
    const capture = fakeThornode(dir, () => NOW);
    const on17: HttpGet = async (url, t) =>
      url.endsWith('/thorchain/inbound_addresses') ? { status: 200, body: inbound17 } : capture(url, t);
    const map = await route(on17).open();
    expect(map).toMatchObject({ BCH: true, ETH: true, BSC: true, AVAX: true, TRON: true, BASE: false });
    const assets = withLive(assetsOff(shipped.thorchain.assets), ['ETH', 'BASE']);
    // One halted chain hides its own assets; the route stays open for the rest (the old every-chain rule paused it all).
    expect(routeOpenFor(map, liveAssets(assets))).toBe(true);
    expect(offered(assets, 'out', map).map((a) => a.chain)).toEqual(['ETH', 'ETH']);
    expect(routeOpenFor(map, liveAssets(withLive(assetsOff(shipped.thorchain.assets), ['BASE'])))).toBe(false);
    expect(routeOpenFor({ ...map, BCH: false }, liveAssets(assets))).toBe(false);
    expect(offered(assets, 'in', { ...map, BCH: false })).toEqual([]);
    expect(routeOpenFor(map, [])).toBe(false);
  });

  it('offers the page only live choices on open chains, and every live choice while the open map is unknown', async () => {
    const map = await route(fakeThornode(dir, () => NOW, 'inbound-2026-11-17.json')).open();
    expect(map.BASE).toBe(false);
    const assets = withLive(shipped.thorchain.assets, ['ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', 'BSC', 'BASE']);
    const shown = (open: Record<string, boolean> | null) => openChoices(assets, shipped.evm.chains, 'out', open).map((c) => c.asset.split('-')[0]);
    expect(shown(map)).toEqual(['ETH.USDC', 'BSC.USDC', 'BSC.USDT']);
    expect(shown(null)).toEqual(['ETH.USDC', 'BSC.USDC', 'BSC.USDT', 'BASE.USDC']);
    expect(shown({ ...map, BCH: false })).toEqual([]);
    // Each choice carries its own chain entry and token decimals (BNB Smart Chain 18).
    const bsc = openChoices(assets, shipped.evm.chains, 'in', map).find((c) => c.chain.key === 'BSC');
    expect(bsc?.token.decimals).toBe(18);
  });

  it('counts a chain missing from the list as closed, and throws when THORNode does not answer', async () => {
    expect(await route().open()).toEqual({ BASE: true, BCH: true });
    const map = await route().open();
    expect(routeOpenFor(map, liveAssets(withLive(shipped.thorchain.assets, ['ETH'])))).toBe(false);
    const down: HttpGet = async () => {
      throw new Error('down');
    };
    await expect(route(down).open()).rejects.toBeInstanceOf(RouteError);
  });
});
