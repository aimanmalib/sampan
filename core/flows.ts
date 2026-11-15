// Which flows are open, and which text keys may describe them. Page text only promises a flow whose flag is on
// (a flag is switched on after the flow is measured on mainnet). Every combination has its own lang key so each
// language can phrase it whole instead of gluing sentence parts together.

export interface FlowFlags {
  features: { swap: boolean; landing: boolean };
  route: { active: string; symbols: string[] };
  compliance: { crossChainEnabled: boolean };
}

export interface OpenFlows {
  /** Swap BCH and the stablecoin on Bitcoin Cash. */
  swap: boolean;
  /** Landing address: BCH from any wallet arrives as the stablecoin, or goes back. */
  land: boolean;
  /** Crossing to and from another chain through the active route. */
  cross: boolean;
}

export type FlowCombo = 'none' | 'swap' | 'land' | 'cross' | 'swap-land' | 'swap-cross' | 'land-cross' | 'swap-land-cross';

export type TabId = 'swap' | 'out' | 'in';

export function openFlows(c: FlowFlags | null): OpenFlows {
  if (!c) return { swap: false, land: false, cross: false };
  return {
    swap: c.features.swap,
    land: c.features.landing,
    cross: c.compliance.crossChainEnabled && c.route.active !== 'none' && c.route.symbols.length > 0,
  };
}

export function flowCombo(f: OpenFlows): FlowCombo {
  const parts = (['swap', 'land', 'cross'] as const).filter((k) => f[k]);
  return parts.length === 0 ? 'none' : (parts.join('-') as FlowCombo);
}

export const heroSubKey = (f: OpenFlows) => `hero.sub.${flowCombo(f)}` as const;
export const descriptionKey = (f: OpenFlows) => `meta.description.${flowCombo(f)}` as const;

/** Tabs whose flow is open. "Bring in" covers both the landing address and crossings in. */
export function openTabs(f: OpenFlows): TabId[] {
  const tabs: TabId[] = [];
  if (f.swap) tabs.push('swap');
  if (f.cross) tabs.push('out');
  if (f.land || f.cross) tabs.push('in');
  return tabs;
}

/** "USDC" or "USDC and USDT": the assets the active route carries, in the page's own word for "and". */
export function symbolList(symbols: string[], and: string): string {
  if (symbols.length < 2) return symbols.join('');
  return `${symbols.slice(0, -1).join(', ')} ${and} ${symbols[symbols.length - 1]}`;
}
