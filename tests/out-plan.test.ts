import { describe, expect, it } from 'vitest';
import type { WireOutQuote } from '../core/client/out.js';
import type { OneClickAsset } from '../core/oneclick-config.js';
import { oneClickLivePatch, outIntent, outLabel, overBudget, type OutPick } from '../tools/measure/out-plan.js';

const pick: OutPick = {
  source: 'PUSD',
  amount: 180n,
  decimals: 2,
  asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
  chain: 'ETH',
  symbol: 'USDC',
  destination: '0x1a877169bB03400fA69EC4813889E78994D194Cb',
  category: 'AB'.repeat(32),
  feeCapSats: 5000n,
  business: { feeBps: 0, feeAddress: '' },
};

const quote = {
  source: 'PUSD',
  amount: '180',
  usd: 1.77,
  swap: { minReceive: '845000' },
  route: 'thorchain',
  sats: '850000',
  vault: 'bitcoincash:qzat5qhem4xrcy6k20k2v8l837wt5rvrnykj63fjv5',
  memo: '=:ETH.USDC:0x1a877169bB03400fA69EC4813889E78994D194Cb:149492366',
  asset: 'ETH.USDC',
  destination: '0x1a877169bb03400fa69ec4813889e78994d194cb',
  expectedOut: '151768900',
  minOut: '149492366',
  outDecimals: 8,
  fees: { total: '25331900', totalBps: 1253 },
  expiry: 0,
  seconds: 600,
} as unknown as WireOutQuote;

describe('measured Send out plan', () => {
  it('builds the intent the page would build from the quote', () => {
    const i = outIntent(pick, quote);
    expect(i.minOut).toBe(149492366n);
    expect(i.swapMinReceive).toBe(845000n);
    expect(i.asset).toBe(pick.asset);
    expect(i.prompts.deposit).toContain('1.8 PUSD');
  });

  it('refuses a quote for another amount, source or destination', () => {
    expect(() => outIntent({ ...pick, amount: 181n }, quote)).toThrow(/another amount/);
    expect(() => outIntent({ ...pick, source: 'BCH', decimals: 8 }, quote)).toThrow(/another amount or source/);
    expect(() => outIntent({ ...pick, destination: `0x${'1'.repeat(40)}` }, quote)).toThrow(/destination/);
  });

  it('needs the step 1 swap for a stablecoin source', () => {
    const noSwap = { ...quote, swap: undefined } as unknown as WireOutQuote;
    expect(() => outIntent(pick, noSwap)).toThrow(/step 1/);
  });

  it('keeps every run inside the test budget', () => {
    const b = { maxUsdPerTx: 3, maxUsdPerDay: 12 };
    expect(overBudget(1.77, 3, b)).toBeNull();
    expect(overBudget(3.01, 0, b)).toMatch(/per-transaction/);
    expect(overBudget(2, 10.5, b)).toMatch(/daily/);
    expect(overBudget(0, 0, b)).toMatch(/no USD/);
  });

  it('labels the row with the source amount and the shown minimum', () => {
    expect(outLabel(pick, quote)).toBe('1.8 PUSD to ETH.USDC (at least 1.49492366 USDC)');
  });

  it('sends the 1Click route only on a 1Click quote, and refuses a quote from the other route', () => {
    const oc = { ...quote, route: 'near-intents' } as WireOutQuote;
    expect(outIntent({ ...pick, route: 'near-intents' }, oc).route).toBe('near-intents');
    expect(outIntent(pick, quote).route).toBeUndefined();
    expect(() => outIntent({ ...pick, route: 'near-intents' }, quote)).toThrow(/another route/);
    expect(() => outIntent(pick, oc)).toThrow(/another route/);
  });

  it('offers exactly one 1Click asset in one direction on the measuring server', () => {
    const assets: OneClickAsset[] = [
      { id: 'a', chain: 'ETH', symbol: 'USDC', decimals: 6, live: { out: false, in: true } },
      { id: 'b', chain: 'BASE', symbol: 'USDC', decimals: 6, live: { out: true, in: false } },
    ];
    const p = oneClickLivePatch(assets, 'ETH', 'USDC', 'out');
    expect(p.features.oneClick).toBe(true);
    expect(p.oneClick.assets.map((a) => a.live)).toEqual([{ out: true, in: false }, { out: false, in: false }]);
    expect(() => oneClickLivePatch(assets, 'BSC', 'USDC', 'out')).toThrow(/not in config/);
  });
});
