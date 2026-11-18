// The networks a crossing panel offers from both routes (KSG3): 1Click's live assets stay offered while THORChain
// halts the same chain; an asset 1Click does not mark live is not offered; THORChain's own choices are unchanged.
import { describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { normalizeConfig, type SampanConfig } from '../core/config.js';
import { crossChoices, oneClickOffers } from '../core/cross-choices.js';
import type { RouteAsset } from '../core/route-assets.js';

const config = normalizeConfig(shipped as unknown as SampanConfig);
const chains = config.evm.chains;
// Fixture assets (not the shipped live flags): THORChain offers USDC on Ethereum and BNB Smart Chain both ways.
const thor: RouteAsset[] = [
  { asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', chain: 'ETH', symbol: 'USDC', live: { out: true, in: true } },
  { asset: 'BSC.USDC-0X8AC76A51CC950D9822D68B83FE1AD97B32CD580D', chain: 'BSC', symbol: 'USDC', live: { out: true, in: true } },
];
const ocAssets = [
  { chain: 'ETH', symbol: 'USDC', live: { out: true, in: true } },
  { chain: 'BASE', symbol: 'USDC', live: { out: true, in: false } },
];
const on = { enabled: true, assets: ocAssets };
const keys = (cs: Array<{ chain: { key: string }; symbol: string; thor: boolean }>) => cs.map((c) => `${c.chain.key}.${c.symbol}:${c.thor ? 'thor' : '1click'}`);

describe('crossChoices', () => {
  it('offers a 1Click asset while THORChain halts its chain, and THORChain where it is open', () => {
    const open = { BCH: true, ETH: false, BASE: false, BSC: true };
    expect(keys(crossChoices(thor, chains, 'out', open, on))).toEqual(['BSC.USDC:thor', 'ETH.USDC:1click', 'BASE.USDC:1click']);
    // In: Base is not live in for 1Click, so only Ethereum through 1Click next to THORChain's BNB Smart Chain.
    expect(keys(crossChoices(thor, chains, 'in', open, on))).toEqual(['BSC.USDC:thor', 'ETH.USDC:1click']);
  });

  it('lists a chain once, as THORChain, while both routes offer it', () => {
    const open = { BCH: true, ETH: true, BSC: true };
    expect(keys(crossChoices(thor, chains, 'out', open, on))).toEqual(['ETH.USDC:thor', 'BSC.USDC:thor', 'BASE.USDC:1click']);
  });

  it('keeps 1Click choices when THORChain reports Bitcoin Cash halted (its whole route paused)', () => {
    expect(keys(crossChoices(thor, chains, 'out', { BCH: false, ETH: true, BSC: true }, on))).toEqual(['ETH.USDC:1click', 'BASE.USDC:1click']);
  });

  it('offers nothing from 1Click while the flag is off or the asset is not live', () => {
    const open = { BCH: true, ETH: false, BSC: false };
    expect(crossChoices(thor, chains, 'out', open, { ...on, enabled: false })).toEqual([]);
    const none = { enabled: true, assets: ocAssets.map((a) => ({ ...a, live: { out: false, in: false } })) };
    expect(crossChoices(thor, chains, 'out', open, none)).toEqual([]);
    expect(oneClickOffers(none, 'out')).toBe(false);
    expect(oneClickOffers(on, 'in')).toBe(true);
    expect(oneClickOffers({ ...on, enabled: false }, 'out')).toBe(false);
  });

  it('keys a 1Click choice by the THORChain asset name when config lists one, else by chain and symbol', () => {
    const [eth] = crossChoices(thor, chains, 'out', { BCH: true, ETH: false, BSC: true }, on).filter((c) => !c.thor);
    expect(eth?.asset).toBe('ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48');
    const base = crossChoices([], chains, 'out', { BCH: true }, on).find((c) => c.chain.key === 'BASE');
    expect(base?.asset).toBe('BASE.USDC');
  });

  it('ships BASE.USDC on 1Click with live false, so the page does not offer it yet', () => {
    const shippedBase = config.oneClick.assets.find((a) => a.chain === 'BASE' && a.symbol === 'USDC');
    expect(shippedBase).toMatchObject({ id: expect.stringMatching(/^nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913\.omft\.near$/) });
    const offer = { enabled: true, assets: config.oneClick.assets.map((a) => (a === shippedBase ? a : { ...a, live: { out: true, in: true } })) };
    const flags = shippedBase!.live;
    const listed = crossChoices([], chains, 'out', null, offer).some((c) => c.chain.key === 'BASE');
    expect(listed).toBe(flags.out);
  });
});
