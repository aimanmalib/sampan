// The receipt's arithmetic (core/receipt) and its explorer links (core/client/explorer): hosts from config only.
import { describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { normalizeConfig, publicConfig, type SampanConfig } from '../core/config.js';
import { fullTxid, txUrl, type ExplorerConfig } from '../core/client/explorer.js';
import { bchPriceOf, receiptOf, routeAmount, routeSymbol, type ReceiptInput } from '../core/receipt.js';

const USDC = 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48';
const stable = (a: string) => a === USDC;
const BCH_TX = 'ab'.repeat(32);
const EVM_TX = 'cd'.repeat(32);

describe('bchPriceOf', () => {
  it('out: what the route pays, fees included, for the satoshis it receives', () => {
    // 1 000 000 sats for 2.5 USDC expected plus 0.25 fees (8 decimals): 2.75 USD per 0.01 BCH.
    const p = bchPriceOf('out', { sats: '1000000', expectedOut: '250000000', outDecimals: 8, fees: { liquidity: '5000000', outbound: '20000000', affiliate: '0' } })!;
    expect((1_000_000n * p.num) / p.den).toBe(2_750_000n);
  });
  it('out: a 6-decimal output is scaled', () => {
    const p = bchPriceOf('out', { sats: '1000000', expectedOut: '2500000', outDecimals: 6, fees: { liquidity: '0', outbound: '250000', affiliate: '0' } })!;
    expect((1_000_000n * p.num) / p.den).toBe(2_750_000n);
  });
  it('in: what the route charges, fees included, for the satoshis it sends', () => {
    // 3 USDC for 900 000 sats expected plus 100 000 sats of fees: 3 USD per 0.01 BCH.
    const p = bchPriceOf('in', { amount: '300000000', expectedSats: '900000', fees: { liquidity: '40000', outbound: '60000', affiliate: '0' } })!;
    expect((1_000_000n * p.num) / p.den).toBe(3_000_000n);
  });
  it('no quote, or not this shape: no price', () => {
    expect(bchPriceOf('out', null)).toBeNull();
    expect(bchPriceOf('out', { sats: '0', expectedOut: '1' })).toBeNull();
    expect(bchPriceOf('in', { amount: 'x', expectedSats: '1' })).toBeNull();
  });
});

const outInput = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({
  kind: 'out',
  legs: [
    { chain: 'BCH', txid: BCH_TX },
    { chain: 'THOR', txid: BCH_TX.toUpperCase() },
    { chain: 'ETH', txid: EVM_TX },
  ],
  refunded: false,
  paid: { asset: 'BCH.BCH', amount: 1_000_000n },
  received: { asset: USDC, amount: 250_000_000n },
  price: { num: 2_750_000n, den: 1_000_000n },
  stable,
  seconds: 467,
  ...over,
});

describe('receiptOf', () => {
  it('out: paid in BCH at the quote price, received in USD 1 stablecoins, kept = received / paid', () => {
    const r = receiptOf(outInput());
    expect(r).toMatchObject({ paidUsd: 2_750_000n, receivedUsd: 2_500_000n, costUsd: 250_000n, keepPct: 90.9, seconds: 467 });
    expect(r.legs).toHaveLength(3);
  });
  it('in: paid in stablecoins, received in BCH', () => {
    const r = receiptOf({
      ...outInput(),
      kind: 'in',
      paid: { asset: USDC, amount: 180_000_000n },
      received: { asset: 'BCH.BCH', amount: 500_000n },
      price: { num: 3n, den: 1n },
    });
    expect(r).toMatchObject({ paidUsd: 1_800_000n, receivedUsd: 1_500_000n, costUsd: 300_000n, keepPct: 83.33 });
  });
  it('a refund comes back in the asset paid', () => {
    const r = receiptOf(outInput({ refunded: true, received: { asset: 'BCH.BCH', amount: 900_000n } }));
    expect(r).toMatchObject({ refunded: true, receivedUsd: 2_475_000n, keepPct: 90 });
  });
  it('coins that are not what this kind of crossing moves are not shown or valued', () => {
    expect(receiptOf(outInput({ paid: { asset: USDC, amount: 1n } }))).toMatchObject({ paid: null, received: null, costUsd: null, keepPct: null });
    expect(receiptOf(outInput({ received: { asset: 'ETH.ETH', amount: 1n } }))).toMatchObject({ received: null, costUsd: null });
    expect(receiptOf({ ...outInput(), kind: 'in' })).toMatchObject({ paid: null, costUsd: null });
  });
  it('without the quote price the amounts stay, the USD values and the cost do not', () => {
    const r = receiptOf(outInput({ price: null }));
    expect(r).toMatchObject({ paidUsd: null, receivedUsd: 2_500_000n, costUsd: null, keepPct: null });
    expect(r.paid?.amount).toBe(1_000_000n);
  });
  it('amounts as text', () => {
    expect(routeAmount(1_000_000n)).toBe('0.01');
    expect(routeAmount(184_525_600n, 2)).toBe('1.845256');
    expect(routeAmount(200_000_000n, 2)).toBe('2.00');
    expect(routeSymbol(USDC)).toBe('USDC');
    expect(routeSymbol('BCH.BCH')).toBe('BCH');
  });
});

describe('txUrl', () => {
  const server = normalizeConfig(shipped as unknown as SampanConfig);
  const c: ExplorerConfig = publicConfig(server);
  it('the page gets the THORChain explorer from config, not the THORChain section', () => {
    expect(c.routeExplorerTxUrl).toBe(server.thorchain.explorerTxUrl);
    expect(c.routeExplorerTxUrl).toMatch(/^https:\/\/.+\{txid\}/);
  });
  it('every link is built from config: Bitcoin Cash, THORChain and each EVM chain', () => {
    expect(txUrl(c, 'BCH', BCH_TX)).toBe(c.connect.explorerTxUrl.replace('{txid}', BCH_TX));
    expect(txUrl(c, 'THOR', BCH_TX.toUpperCase())).toBe(c.routeExplorerTxUrl.replace('{txid}', BCH_TX));
    for (const ch of c.evm.chains) expect(txUrl(c, ch.key, `0x${EVM_TX.toUpperCase()}`)).toBe(`${ch.explorer}/tx/0x${EVM_TX}`);
  });
  it('another config gives other hosts (none is written in the code)', () => {
    const other: ExplorerConfig = {
      connect: { explorerTxUrl: 'https://b.example/t/{txid}' },
      routeExplorerTxUrl: 'https://r.example/x/{txid}?n=1',
      evm: { chains: [{ key: 'ETH', explorer: 'https://e.example' }] },
    };
    expect(txUrl(other, 'bch', BCH_TX)).toBe(`https://b.example/t/${BCH_TX}`);
    expect(txUrl(other, 'THOR', BCH_TX)).toBe(`https://r.example/x/${BCH_TX}?n=1`);
    expect(txUrl(other, 'ETH', EVM_TX)).toBe(`https://e.example/tx/0x${EVM_TX}`);
  });
  it('an unknown chain or a malformed id has no link', () => {
    expect(txUrl(c, 'DOGE', BCH_TX)).toBeNull();
    expect(txUrl(c, 'BCH', 'zz')).toBeNull();
  });
  it('full ids: lower case, 0x on EVM chains', () => {
    expect(fullTxid('THOR', BCH_TX.toUpperCase())).toBe(BCH_TX);
    expect(fullTxid('ETH', EVM_TX)).toBe(`0x${EVM_TX}`);
  });
});
