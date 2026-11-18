// The status line parts and the "Paused by the route" switch from a health report.
import { describe, expect, it } from 'vitest';
import en from '../lang/en.json' with { type: 'json' };
import { healthParts, routeHalted, routeOpenMap, type HealthKey, type HealthReport } from '../core/client/health.js';

const t = (k: HealthKey): string => en[k];
const name = (id: string): string => (en as Record<string, string>)[`route.${id}`] ?? id;
const report = (over: Partial<HealthReport>): HealthReport => ({ checkedAt: 1, cauldron: true, bch: true, height: 900_000, route: null, ...over });

describe('healthParts', () => {
  it('is empty before the first check', () => {
    expect(healthParts(null, t, name)).toEqual([]);
    expect(healthParts(report({ checkedAt: null }), t, name)).toEqual([]);
  });

  it('lists Cauldron and Bitcoin Cash, and the route only when the server checks it', () => {
    expect(healthParts(report({}), t, name).map((p) => p.id)).toEqual(['cauldron', 'bch']);
    const parts = healthParts(report({ bch: false, route: { id: 'thorchain', open: false } }), t, name);
    expect(parts.map((p) => [p.id, p.state])).toEqual([
      ['cauldron', 'ok'],
      ['bch', 'down'],
      ['route', 'halted'],
    ]);
    expect(parts[2]!.text).toBe(`${en['route.thorchain']} ${en['health.halted']}`);
  });

  it('names only Bitcoin Cash when the server could not check the pools (Cauldron unknown after a check)', () => {
    const parts = healthParts(report({ cauldron: null, bch: false }), t, name);
    expect(parts.map((p) => [p.id, p.state])).toEqual([['bch', 'down']]);
  });

  it('shows a route that could not be asked as not answering, not as paused', () => {
    const parts = healthParts(report({ route: { id: 'thorchain', open: null } }), t, name);
    expect(parts[2]).toMatchObject({ id: 'route', state: 'down', text: `${en['route.thorchain']} ${en['health.down']}` });
  });
});

describe('routeHalted', () => {
  it('is true only when the last check saw the route halted', () => {
    expect(routeHalted(null)).toBe(false);
    expect(routeHalted(report({}))).toBe(false);
    expect(routeHalted(report({ route: { id: 'thorchain', open: null } }))).toBe(false);
    expect(routeHalted(report({ route: { id: 'thorchain', open: true } }))).toBe(false);
    expect(routeHalted(report({ route: { id: 'thorchain', open: false } }))).toBe(true);
  });
});

describe('routeOpenMap', () => {
  it('passes the per-chain map on, closes every chain for a halted route without one, and is unknown otherwise', () => {
    expect(routeOpenMap(null)).toBeNull();
    expect(routeOpenMap(report({ route: { id: 'thorchain', open: null } }))).toBeNull();
    expect(routeOpenMap(report({ route: { id: 'thorchain', open: true } }))).toBeNull();
    expect(routeOpenMap(report({ route: { id: 'thorchain', open: false } }))).toEqual({});
    expect(routeOpenMap(report({ route: { id: 'thorchain', open: false, chains: { BCH: true, ETH: false } } }))).toEqual({ BCH: true, ETH: false });
  });
});
