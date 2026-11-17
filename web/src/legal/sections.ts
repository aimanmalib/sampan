// Which /terms or /risks sections a visitor sees. Kept apart from the page so it can be tested without a browser.
import type { LegalSection } from '../../../core/config.js';
import { openFlows, type FlowFlags } from '../../../core/flows.js';

export type LegalKind = 'terms' | 'risks';

export interface LegalFlags extends FlowFlags {
  features: FlowFlags['features'] & { oneClick: boolean };
  legal: Record<LegalKind, LegalSection[]>;
}

/** A `cross` section needs cross-chain flows open; a `oneClick` section needs features.oneClick. */
export function shownSections(config: LegalFlags, kind: LegalKind): LegalSection[] {
  const cross = openFlows(config).cross;
  return config.legal[kind].filter((s) => (!s.cross || cross) && (!s.oneClick || config.features.oneClick));
}
