// The crossing claims the page shows are made from config (K6P1, ADR 0083): per chain the symbols out and in, the
// routes carrying them, and the chip each chain gets. Fixtures only; the shipped config is checked for shape.
import { describe, expect, it } from 'vitest';
import shipped from '../config/sampan.json' with { type: 'json' };
import { chipKey, claimsFor, liveRoutes, routeClaims, type ClaimOffer } from '../core/route-claims.js';
import type { EvmChain, RouteAsset } from '../core/route-assets.js';

const chain = (key: string, name: string, symbols: string[]): EvmChain =>
  ({ key, name, tokens: Object.fromEntries(symbols.map((s) => [s, { address: `0x${key}${s}`, decimals: 6 }])) }) as unknown as EvmChain;
const asset = (c: string, s: string, out: boolean, inn: boolean): RouteAsset => ({ asset: `${c}.${s}-X`, chain: c, symbol: s, live: { out, in: inn } });
const chains = [chain('ETH', 'Ethereum', ['USDC']), chain('BSC', 'BNB Smart Chain', ['USDC', 'USDT']), chain('AVAX', 'Avalanche C-Chain', ['USDC', 'USDT']), chain('BASE', 'Base', ['USDC'])];

function offer(over: Partial<{ thor: RouteAsset[]; oc: ClaimOffer['oneClick']['assets']; ocOn: boolean }> = {}): ClaimOffer {
  return {
    routeAssets: over.thor ?? [asset('ETH', 'USDC', true, true), asset('BSC', 'USDC', true, true), asset('BSC', 'USDT', true, true), asset('AVAX', 'USDC', true, true), asset('AVAX', 'USDT', true, false)],
    evm: { chains },
    features: { oneClick: over.ocOn ?? true },
    oneClick: { assets: over.oc ?? [{ id: 'eth', chain: 'ETH', symbol: 'USDC', live: { out: true, in: true } }, { id: 'base', chain: 'BASE', symbol: 'USDC', live: { out: true, in: true } }] },
  } as ClaimOffer;
}

describe('routeClaims', () => {
  it('lists each chain once with its symbols per direction and the routes carrying them', () => {
    expect(routeClaims(offer())).toEqual([
      { key: 'ETH', name: 'Ethereum', out: ['USDC'], in: ['USDC'], via: ['thorchain', 'near-intents'] },
      { key: 'BSC', name: 'BNB Smart Chain', out: ['USDC', 'USDT'], in: ['USDC', 'USDT'], via: ['thorchain'] },
      { key: 'AVAX', name: 'Avalanche C-Chain', out: ['USDC', 'USDT'], in: ['USDC'], via: ['thorchain'] },
      { key: 'BASE', name: 'Base', out: ['USDC'], in: ['USDC'], via: ['near-intents'] },
    ]);
  });

  it('drops Avalanche from Bring in and makes its chip "out only" when its in flag is off', () => {
    const thor = [asset('ETH', 'USDC', true, true), asset('AVAX', 'USDC', true, false), asset('AVAX', 'USDT', true, false)];
    const claims = routeClaims(offer({ thor }));
    expect(claimsFor(claims, 'in').flatMap((x) => x.chains)).not.toContain('Avalanche C-Chain');
    expect(claimsFor(claims, 'out').find((x) => x.symbol === 'USDC')?.chains).toContain('Avalanche C-Chain');
    expect(chipKey(claims.find((c) => c.key === 'AVAX')!)).toBe('hero.chip.outOnly');
  });

  it('names NEAR Intents as the route when only 1Click carries an asset', () => {
    const claims = routeClaims(offer({ thor: [] }));
    expect(liveRoutes(claims)).toEqual(['near-intents']);
    expect(claims.map((c) => c.key)).toEqual(['ETH', 'BASE']);
  });

  it('names THORChain alone while 1Click is switched off', () => {
    const claims = routeClaims(offer({ ocOn: false }));
    expect(liveRoutes(claims)).toEqual(['thorchain']);
    expect(claims.map((c) => c.key)).not.toContain('BASE');
  });

  it('keeps a halted chain listed but paused, and a 1Click chain open, from the health map', () => {
    const claims = routeClaims(offer(), { BCH: true, ETH: true, BSC: false, AVAX: true });
    const bsc = claims.find((c) => c.key === 'BSC')!;
    expect(bsc).toMatchObject({ out: [], in: [], via: [] });
    expect(chipKey(bsc)).toBe('hero.chip.paused');
    expect(chipKey(claims.find((c) => c.key === 'BASE')!)).toBe('hero.chip.open');
  });
});

describe('claimsFor', () => {
  it('groups chains under each symbol in first-seen order', () => {
    expect(claimsFor(routeClaims(offer()), 'in')).toEqual([
      { symbol: 'USDC', chains: ['Ethereum', 'BNB Smart Chain', 'Avalanche C-Chain', 'Base'] },
      { symbol: 'USDT', chains: ['BNB Smart Chain'] },
    ]);
  });
});

describe('chipKey', () => {
  it('says one way only when only one direction is open', () => {
    expect(chipKey({ out: ['USDC'], in: ['USDC'] })).toBe('hero.chip.open');
    expect(chipKey({ out: [], in: ['USDC'] })).toBe('hero.chip.inOnly');
    expect(chipKey({ out: [], in: [] })).toBe('hero.chip.paused');
  });
});

describe('shipped config', () => {
  it('every chain the claims name is a configured chain, and every claim has a route', () => {
    const names = shipped.evm.chains.map((c) => c.name);
    const live = shipped.thorchain.assets.filter((a) => a.live.out || a.live.in);
    const claims = routeClaims({ routeAssets: live, evm: shipped.evm, features: shipped.features, oneClick: shipped.oneClick } as unknown as ClaimOffer);
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) {
      expect(names).toContain(c.name);
      if (c.out.length + c.in.length > 0) expect(c.via.length).toBeGreaterThan(0);
    }
  });
});
