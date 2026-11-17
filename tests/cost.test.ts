// The cost card (core/cost.ts) on real captures: THORNode quotes for ETH.USDC taken 2026-11-17 (600000 sats out,
// 3 USDC in) and the frozen Cauldron PUSD pools. The parts must add up to what is paid minus what is received.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardText, costMinutes, formatUsd, gasUsd, inCost, outCost, tradeCost, type CostCard, type Gas, type ThorFees } from '../core/cost.js';
import { satsOutForTokens } from '../core/pools/math.js';
import { selectTrade, type SelectedTrade } from '../core/pools/trade.js';
import { pools, PUSD } from './helpers/pools.js';

interface Capture {
  expected_amount_out: string;
  expiry: number;
  total_swap_seconds: number;
  fees: { liquidity: string; outbound: string; affiliate: string; total: string; slippage_bps: number };
}
const capture = (name: string): Capture => JSON.parse(readFileSync(new URL(`./fixtures/thorchain/${name}`, import.meta.url), 'utf8')) as Capture;
const out = capture('quote-out-eth.json');
const into = capture('quote-in-eth.json');
const fees = (c: Capture): ThorFees => ({
  liquidity: BigInt(c.fees.liquidity),
  outbound: BigInt(c.fees.outbound),
  affiliate: BigInt(c.fees.affiliate),
  slippageBps: c.fees.slippage_bps,
});

const OUT_SATS = 600_000n;
const IN_UNITS = 300_000_000n;
const timing = { routeSeconds: 606, sourceBlockSeconds: 600, measured: [] as number[] };
const sell = (tokens: bigint): SelectedTrade => selectTrade(pools, PUSD, { side: 'sell', target: 'supply', amount: tokens, maxPools: 5, satsPerByte: 1n });
const buy = (sats: bigint): SelectedTrade => selectTrade(pools, PUSD, { side: 'buy', target: 'supply', amount: sats, maxPools: 5, satsPerByte: 1n });

/** What was paid minus what was received (and kept as BCH), against the sum of the named parts. */
const gap = (c: CostCard): bigint => c.payUsd - c.receiveUsd - c.leftoverUsd - c.totalUsd;
const part = (c: CostCard, key: string): bigint | undefined => c.parts.find((p) => p.key === key)?.usd;
const CENT = 10_000n;

const outFromToken = (tokens: bigint, warnBps = 500, sampanFeeBps = 0n) => {
  const t = sell(tokens);
  const { poolFeeSats, impactBps } = tradeCost(t);
  return outCost({
    fromToken: true,
    amount: tokens,
    tokenDecimals: 2,
    swap: { supply: t.supply, demand: t.demand, poolFeeSats, sampanFeeSats: (t.demand * sampanFeeBps) / 10_000n, impactBps, networkSats: 900n },
    depositSats: OUT_SATS,
    depositNetworkSats: 690n,
    expectedOut: BigInt(out.expected_amount_out),
    fees: fees(out),
    expiry: out.expiry,
    timing,
    warnBps,
  });
};

const gas = (approve: boolean): Gas => ({ approve, approveUnits: 56_361n, depositUnits: 68_758n, priceWei: 123_200_000n, nativeUsdE8: 183_060_000_000n });

describe('cost card: Send out', () => {
  it('from PUSD: the parts add up to paid minus received, to under a hundredth of a cent', () => {
    const c = outFromToken(150n);
    expect(c.payUsd).toBe(1_500_000n);
    expect(c.receiveUsd).toBe(998_063n);
    expect(c.leftoverUsd).toBeGreaterThan(0n);
    expect(gap(c) >= -100n && gap(c) <= 100n).toBe(true);
  });

  it('names THORChain liquidity and outbound fees exactly as the quote gives them', () => {
    const c = outFromToken(150n);
    expect(part(c, 'thorOutbound')).toBe(249_672n);
    expect(part(c, 'thorLiquidity')).toBe(2_499n);
    // A zero affiliate fee is not listed.
    expect(part(c, 'thorAffiliate')).toBeUndefined();
  });

  it('without the outbound fee the parts no longer add up (the check catches a missing part)', () => {
    const c = outFromToken(150n);
    const short = c.totalUsd - part(c, 'thorOutbound')!;
    expect(c.payUsd - c.receiveUsd - c.leftoverUsd - short).toBeGreaterThan(CENT);
  });

  it('from BCH: only the deposit network fee and the route fees', () => {
    const c = outCost({
      fromToken: false,
      amount: OUT_SATS,
      tokenDecimals: 2,
      depositSats: OUT_SATS,
      depositNetworkSats: 690n,
      expectedOut: BigInt(out.expected_amount_out),
      fees: fees(out),
      expiry: out.expiry,
      timing,
      warnBps: 500,
    });
    expect(c.parts.map((p) => p.key)).toEqual(['bchNetwork', 'thorLiquidity', 'thorOutbound']);
    expect(c.leftoverUsd).toBe(0n);
    expect(gap(c) >= -100n && gap(c) <= 100n).toBe(true);
    expect(c.impactBps).toBe(19);
    expect(c.expiresAt).toBe(out.expiry);
  });

  it('with a Sampan fee (business.feeBps > 0) the fee is a named part and the parts still add up', () => {
    const c = outFromToken(150n, 500, 30n);
    const fee = part(c, 'sampanFee');
    expect(fee).toBeGreaterThan(CENT / 10n);
    expect(gap(c) >= -100n && gap(c) <= 100n).toBe(true);
    // The same trade without the fee keeps that much more in the wallet.
    const free = outFromToken(150n);
    expect(free.leftoverUsd - c.leftoverUsd - fee! <= 1n && free.leftoverUsd - c.leftoverUsd - fee! >= -1n).toBe(true);
  });

  it('keep share is (received + left in the wallet) / paid', () => {
    const c = outFromToken(150n);
    expect(c.keepPct).toBe(Number(((c.receiveUsd + c.leftoverUsd) * 10_000n) / c.payUsd) / 100);
    expect(c.keepPct).toBeLessThan(100);
  });

  it('warns when the cost is above limits.feeWarnBps, and not below it', () => {
    expect(outFromToken(150n, 500).warn.cost).toBe(true);
    expect(outFromToken(150n, 5_000).warn.cost).toBe(false);
  });
});

describe('cost card: Bring in', () => {
  const base = { amount: IN_UNITS, expectedSats: BigInt(into.expected_amount_out), fees: fees(into), expiry: into.expiry, timing, warnBps: 500 };

  it('to BCH: parts add up, gas included in what is paid', () => {
    const c = inCost({ ...base, gas: gas(true) });
    expect(c.payUsd).toBe(3_000_000n + gasUsd(gas(true)));
    expect(part(c, 'gas')).toBe(gasUsd(gas(true)));
    expect(gap(c) >= -100n && gap(c) <= 100n).toBe(true);
  });

  it('gas: no approval when the allowance already covers the amount', () => {
    // 68758 gas at 0.1232 gwei, ETH at 1830.60 USD = 0.0155066 USD, rounded down to the micro-dollar.
    expect(gasUsd(gas(false))).toBe(15_506n);
    expect(gasUsd(gas(true))).toBeGreaterThan(gasUsd(gas(false)));
    expect(part(inCost({ ...base }), 'gas')).toBeUndefined();
  });

  it('to PUSD through a landing address: conversion fee, pool fee and impact; token dust stays with the owner', () => {
    const supply = BigInt(into.expected_amount_out) - 1_000n - 700n;
    const t = buy(supply);
    const { poolFeeSats, impactBps } = tradeCost(t);
    const c = inCost({
      ...base,
      gas: gas(true),
      landing: { swap: { supply: t.supply, demand: t.demand, poolFeeSats, sampanFeeSats: 0n, impactBps }, convertFeeSats: 700n, tokenDustSats: 1_000n, tokenDecimals: 2 },
    });
    expect(c.receiveUsd).toBe(t.demand * 10_000n);
    expect(part(c, 'convertNetwork')).toBeGreaterThan(0n);
    expect(part(c, 'poolFee')).toBeGreaterThan(0n);
    expect(c.leftoverUsd).toBeGreaterThan(0n);
    expect(gap(c) >= -100n && gap(c) <= 100n).toBe(true);
    expect(c.impactBps).toBe(19 + impactBps);
  });
});

describe('cost card: pool math and time', () => {
  it('price impact of a sell is the constant-product shortfall against the spot price, fee apart', () => {
    const pool = { txid: '11'.repeat(32), vout: 0, sats: 100_000_000n, tokens: 20_000n, category: PUSD, ownerPkh: '22'.repeat(20) };
    const demand = satsOutForTokens(pool, 100n);
    const after = { sats: pool.sats - demand, tokens: pool.tokens + 100n };
    const trade: SelectedTrade = { side: 'sell', category: PUSD, supply: 100n, demand, legs: [{ pool, supply: 100n, demand, after }] };
    const { poolFeeSats, impactBps } = tradeCost(trade);
    expect(poolFeeSats).toBe((demand * 3n) / 1000n);
    const ideal = 500_000n;
    expect(impactBps).toBe(Number(((ideal - demand - poolFeeSats) * 10_000n) / ideal));
    expect(impactBps).toBeGreaterThan(40);
    expect(impactBps).toBeLessThan(60);
  });

  it('time: one value without measured runs, a range with them', () => {
    expect(costMinutes(timing)).toEqual({ from: 21 });
    expect(costMinutes({ ...timing, measured: [700, 900, 1100] })).toEqual({ from: 15, to: 21 });
    expect(costMinutes({ ...timing, measured: [1201, 1260] })).toEqual({ from: 21 });
  });
});

describe('cost card: USD text', () => {
  it('two decimals, four under one cent, rounded half away from zero, never a bare 0 for a small fee', () => {
    expect(formatUsd(1_500_000n)).toBe('USD 1.50');
    expect(formatUsd(249_672n)).toBe('USD 0.25');
    expect(formatUsd(244_999n)).toBe('USD 0.24');
    expect(formatUsd(2_499n)).toBe('USD 0.0025');
    expect(formatUsd(9_996n)).toBe('USD 0.01');
    expect(formatUsd(0n)).toBe('USD 0.00');
    expect(formatUsd(-12_000n)).toBe('-USD 0.01');
    expect(formatUsd(-15_000n)).toBe('-USD 0.02');
  });

  const cents = (text: string): bigint => {
    const m = /^(-?)USD (\d+)\.(\d+)$/.exec(text);
    if (!m) throw new Error(`not USD: ${text}`);
    const v = BigInt(m[2]! + m[3]!.padEnd(4, '0'));
    return m[1] ? -v : v;
  };
  const adds = (c: CostCard): void => {
    const s = cardText(c);
    expect(cents(s.pay) - cents(s.receive) - (s.leftover ? cents(s.leftover) : 0n)).toBe(cents(s.total));
  };
  const inBase = { amount: IN_UNITS, expectedSats: BigInt(into.expected_amount_out), fees: fees(into), expiry: into.expiry, timing, warnBps: 500 };

  it('on screen, paid minus received minus left in the wallet is the total shown, cent for cent', () => {
    for (const tokens of [150n, 210n, 333n, 500n]) adds(outFromToken(tokens));
    adds(outFromToken(210n, 500, 30n));
    adds(inCost({ ...inBase, gas: gas(true) }));
    adds(inCost({ ...inBase, gas: gas(false) }));
    adds(inCost({ ...inBase }));
  });

  it('the total shown stays within one cent of the sum of the parts', () => {
    for (const c of [outFromToken(210n), inCost({ ...inBase, gas: gas(true) })]) {
      const shown = cents(cardText(c).total) * 100n;
      expect(shown - c.totalUsd <= 15_000n && c.totalUsd - shown <= 15_000n).toBe(true);
    }
  });

  it('the old truncation case: pay 2.10 and receive 1.84 shows a total of 0.26', () => {
    const c = { payUsd: 2_100_000n, receiveUsd: 1_845_100n, leftoverUsd: 0n, totalUsd: 254_900n } as CostCard;
    expect(cardText(c)).toEqual({ pay: 'USD 2.10', receive: 'USD 1.85', total: 'USD 0.25' });
    const d = { payUsd: 2_100_000n, receiveUsd: 1_844_900n, leftoverUsd: 0n, totalUsd: 255_100n } as CostCard;
    expect(cardText(d)).toEqual({ pay: 'USD 2.10', receive: 'USD 1.84', total: 'USD 0.26' });
  });
});

describe('cost card: the card a measured run saves before broadcasting', () => {
  it('maps the quote reply the page gets to the same card, and refuses a quote without named fees', async () => {
    const { costShown, costJson } = await import('../tools/measure/cost-shown.js');
    const { loadConfig } = await import('../server/config.js');
    const { publicConfig } = await import('../core/config.js');
    const config = publicConfig(loadConfig('config/sampan.json'));
    const wire = {
      source: 'BCH',
      amount: '600000',
      usd: 1.25,
      route: 'thorchain',
      sats: '600000',
      vault: 'bitcoincash:qre7hk63vp6jh6vrlt02swgn5pqvsr27j5hvr7tpj9',
      memo: '=:ETH.USDC:0x1a877169bB03400fA69EC4813889E78994D194Cb:0',
      asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      destination: '0x1a877169bB03400fA69EC4813889E78994D194Cb',
      expectedOut: out.expected_amount_out,
      minOut: '0',
      outDecimals: 8,
      fees: { total: out.fees.total, totalBps: 1681, liquidity: out.fees.liquidity, outbound: out.fees.outbound, affiliate: '0', slippageBps: 19 },
      depositNetworkSats: '690',
      expiry: out.expiry,
      seconds: out.total_swap_seconds,
    };
    const txid = 'ab'.repeat(32);
    const saved = costShown(config, 'out', wire, txid, 'ETH', new Date('2026-11-17T12:00:00Z'));
    expect(saved.card.receiveUsd).toBe(998_063n);
    expect(saved.card.parts.find((p) => p.key === 'thorOutbound')?.usd).toBe(249_672n);
    expect(JSON.parse(costJson(saved)).card.totalUsd).toBe(saved.card.totalUsd.toString());
    expect(() => costShown(config, 'out', { ...wire, fees: { total: '1', totalBps: 1 } }, txid, 'ETH', new Date())).toThrow(/no card/);
    expect(() => costShown(config, 'out', wire, 'nope', 'ETH', new Date())).toThrow(/txid/);
  });
});

describe('cost card: a route that reports the received token in its own decimals', () => {
  it('gives the same card for 1Click amounts in 6 decimals as for the same amounts in 1e8 units (ADR 0050)', async () => {
    const { outCard } = await import('../core/client/cost.js');
    const { loadConfig } = await import('../server/config.js');
    const { publicConfig } = await import('../core/config.js');
    const config = publicConfig(loadConfig('config/sampan.json'));
    const in1e8 = {
      source: 'BCH', amount: '600000', usd: 1.25, route: 'thorchain', sats: '600000', vault: 'bitcoincash:q', memo: '', asset: 'ETH.USDC',
      destination: '0x1a877169bB03400fA69EC4813889E78994D194Cb', expectedOut: '138000000', minOut: '0', outDecimals: 8,
      fees: { total: '30000000', totalBps: 1786, liquidity: '0', outbound: '30000000', affiliate: '0', slippageBps: 0 }, depositNetworkSats: '690', expiry: 0, seconds: 120,
    };
    const in6 = { ...in1e8, route: 'near-intents', expectedOut: '1380000', outDecimals: 6, fees: { ...in1e8.fees, total: '300000', outbound: '300000' } };
    const a = outCard(config, in1e8, 'BCH', 600_000n, [])!;
    const b = outCard(config, in6, 'BCH', 600_000n, [])!;
    expect(b.receiveUsd).toBe(a.receiveUsd);
    expect(b.receiveUsd).toBe(1_380_000n);
    expect(b.totalUsd).toBe(a.totalUsd);
  });
});
