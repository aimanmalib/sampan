// The crossing tracer (KP17) against frozen THORNode captures and a Base receipt fixture. No network.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeThornode } from '../server/routes/fake.js';
import { ThorchainRoute } from '../server/routes/thorchain.js';
import { Thornode, type HttpGet } from '../server/routes/thornode.js';
import { loadConfig } from '../server/config.js';
import { crossingAsset, traceCrossing, type CrossDeps, type Crossing, type EvmReceipt } from '../tools/measure/cross.js';
import { runRow } from '../tools/measure/runs.js';

const dir = path.resolve('tests/fixtures/thorchain');
const NOW = 1_794_770_000_000;
const EVM = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const USDC = '0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913';
const BCH_IN = 'ab'.repeat(32);
const BASE_OUT = `0x${'c0'.repeat(32)}`;
const LOCKING = '76a914' + '11'.repeat(20) + '88ac';
const receipt = JSON.parse(readFileSync('tests/fixtures/base/receipt-usdc-out.json', 'utf8')) as EvmReceipt;

const route = (get: HttpGet = fakeThornode(dir, () => NOW)) =>
  new ThorchainRoute({ node: new Thornode(['https://a.example'], get, 1000), slippageBps: 100, minSatsPerByte: 1n, now: () => NOW });

/** The done capture rewritten: `outs` replaces its out_txs (THOR entry kept), for the in direction and sabotage. */
const doneWith = (outs: Array<{ id: string; chain: string }>): HttpGet => {
  const fake = fakeThornode(dir, () => NOW);
  return async (url, t) => {
    const res = await fake(url.replace(/[0-9A-F]{64}$/, 'AB'.repeat(32)), t);
    const body = res.body as { out_txs: Array<{ chain: string }> };
    return { status: 200, body: { ...body, out_txs: [...body.out_txs.filter((o) => o.chain === 'THOR'), ...outs] } };
  };
};

function deps(over: Partial<CrossDeps> & { get?: HttpGet } = {}): CrossDeps {
  let clock = NOW;
  const r = route(over.get);
  return {
    status: (t) => r.status(t),
    evmReceipt: async () => receipt,
    bchHistory: async () => [],
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
    pollMs: 15_000,
    timeoutMs: 10 * 60_000,
    ...over,
  };
}

const out: Crossing = { flow: 'out', chain: 'BASE', firstTxid: BCH_IN, broadcastAt: new Date(NOW - 600_000), amount: '0.01 BCH to 1.80 USDC', destination: EVM, token: USDC };
const into: Crossing = { flow: 'in', chain: 'BASE', firstTxid: BASE_OUT, broadcastAt: new Date(NOW - 60_000), amount: '2 USDC to BCH', destination: LOCKING };
const BCH_OUT = 'de'.repeat(32);

describe('crossing tracer', () => {
  it('writes an out row with both txids in full once USDC reaches the destination on Base', async () => {
    const run = await traceCrossing(out, deps());
    expect(run).toMatchObject({ ok: true, seconds: 600, txid: `bch ${BCH_IN} · base ${BASE_OUT}` });
    const line = runRow(run);
    expect(line).toMatch(/(?<![0-9a-fA-Fx])[0-9a-f]{64}(?![0-9a-f])/);
    expect(line).toMatch(/0x[0-9a-f]{64} \| 600\.0 \| ok \|$/);
  });

  it('fails a crossing the route calls done without a Base transaction', async () => {
    const run = await traceCrossing(out, deps({ get: doneWith([]) }));
    expect(run.ok).toBe(false);
    expect(run.note).toMatch(/without a BASE transaction/);
    expect(runRow(run)).not.toMatch(/0x[0-9a-f]{64}/);
  });

  it('fails when the Base transaction does not pay the destination', async () => {
    const other = { ...receipt, logs: receipt.logs.map((l) => ({ ...l, topics: [l.topics[0]!, l.topics[1]!, `0x${'0'.repeat(24)}${'22'.repeat(20)}`] })) };
    const run = await traceCrossing(out, deps({ evmReceipt: async () => other }));
    expect(run).toMatchObject({ ok: false, note: 'the BASE transaction does not pay the destination' });
    const reverted = await traceCrossing(out, deps({ evmReceipt: async () => ({ ...receipt, status: '0x0' }) }));
    expect(reverted.ok).toBe(false);
  });

  it('keeps waiting while the receipt is missing and fails at the deadline with the stage reached', async () => {
    const run = await traceCrossing(out, deps({ evmReceipt: async () => null, timeoutMs: 60_000 }));
    expect(run).toMatchObject({ ok: false, note: 'nothing arrived in 1 min (waiting for BASE transaction)' });
    const unseen = await traceCrossing({ ...out, firstTxid: `${'ab'.repeat(31)}00` }, deps({ timeoutMs: 60_000 }));
    expect(unseen).toMatchObject({ ok: false, txid: `${'ab'.repeat(31)}00`, note: 'nothing arrived in 1 min (not seen by the route)' });
  });

  it('writes an in row once the BCH transaction is in the destination history, with the conversion when asked', async () => {
    const get = doneWith([{ id: BCH_OUT.toUpperCase(), chain: 'BCH' }]);
    let seen = 0;
    const history = async () => (++seen > 2 ? ['00'.repeat(32), BCH_OUT] : []);
    const run = await traceCrossing(into, deps({ get, bchHistory: history }));
    expect(run).toMatchObject({ ok: true, seconds: 90, txid: `bch ${BCH_OUT} · base ${BASE_OUT}` });
    const converted = await traceCrossing(into, deps({ get, bchHistory: async () => [BCH_OUT], convert: async () => 'ef'.repeat(32) }));
    expect(converted.txid).toBe(`bch ${BCH_OUT} · base ${BASE_OUT} · convert ${'ef'.repeat(32)}`);
  });

  it('fails an in crossing the route calls done with only a THORChain entry, and a refund', async () => {
    expect((await traceCrossing(into, deps({ get: doneWith([]) }))).note).toMatch(/without a BCH transaction/);
    const fake = fakeThornode(dir, () => NOW);
    const refunding: HttpGet = async (url, t) => {
      const body = (await fake(url, t)).body as { planned_out_txs: Array<{ refund: boolean }> };
      return { status: 200, body: { ...body, planned_out_txs: body.planned_out_txs.map((p) => ({ ...p, refund: true })) } };
    };
    expect(await traceCrossing(out, deps({ get: refunding }))).toMatchObject({ ok: false, note: 'refunded by the route' });
  });

  it('keeps a refund paid back on BCH out of the Base cell of an out row', async () => {
    const fake = doneWith([{ id: BCH_OUT.toUpperCase(), chain: 'BCH' }]);
    const refundedOnBch: HttpGet = async (url, t) => {
      const res = await fake(url, t);
      const body = res.body as { planned_out_txs?: Array<{ refund: boolean }> };
      return { status: 200, body: { ...body, planned_out_txs: [{ chain: 'BCH', refund: true }] } };
    };
    const run = await traceCrossing(out, deps({ get: refundedOnBch }));
    expect(run).toMatchObject({ ok: false, txid: BCH_IN, note: `refunded by the route (bch ${BCH_OUT})` });
    expect(run.txid).not.toMatch(/base 0x/);
    expect(runRow(run)).not.toMatch(/0x[0-9a-f]{64}/);
  });

  it('names the asset chain in the txid cell, and fails a crossing paid out on another chain (2026-11-17: ETH first)', async () => {
    const eth: Crossing = { ...out, chain: 'ETH' };
    const run = await traceCrossing(eth, deps({ get: doneWith([{ id: BASE_OUT.slice(2).toUpperCase(), chain: 'ETH' }]) }));
    expect(run).toMatchObject({ ok: true, txid: `bch ${BCH_IN} · eth ${BASE_OUT}` });
    expect(runRow(run)).toMatch(/\beth 0x[0-9a-f]{64}\b/);
    const elsewhere = await traceCrossing(eth, deps({ get: doneWith([{ id: BASE_OUT.slice(2).toUpperCase(), chain: 'BASE' }]) }));
    expect(elsewhere).toMatchObject({ ok: false, note: 'route reports done without a ETH transaction' });
    const into = await traceCrossing({ flow: 'in', chain: 'BSC', firstTxid: BASE_OUT, broadcastAt: new Date(NOW - 60_000), amount: '1 USDC to BCH', destination: LOCKING }, deps({ get: doneWith([{ id: BCH_OUT.toUpperCase(), chain: 'BCH' }]), bchHistory: async () => [BCH_OUT] }));
    expect(into.txid).toBe(`bch ${BCH_OUT} · bsc ${BASE_OUT}`);
  });

  it('reads chain, token and RPC endpoints for --asset from config, never from code', () => {
    const config = loadConfig('config/sampan.json');
    for (const a of config.thorchain.assets.filter((x) => x.chain !== 'TRON')) {
      const c = crossingAsset(config, a.asset);
      expect(a.asset.endsWith(c.token.slice(2).toUpperCase())).toBe(true);
      expect(c.chain).toBe(a.chain);
      expect(c.rpc.length).toBeGreaterThanOrEqual(2);
    }
    expect(() => crossingAsset(config, 'ETH.DAI-0X6B175474E89094C44DA98B954EEDEAC495271D0F')).toThrow(/not in config/);
  });
});
