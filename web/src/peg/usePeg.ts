// GET /api/depth, asked once per page load and shared by every panel and the /how block. A failed read is 'down'
// (the page shows no numbers then, never zeros).
import { useEffect, useState } from 'react';
import type { DepthReport } from '../../../core/peg';
import { api } from '../api';

export type DepthState = DepthReport | 'loading' | 'down';

let once: Promise<DepthReport | 'down'> | null = null;
const load = (): Promise<DepthReport | 'down'> => (once ??= api.get<DepthReport>('/api/depth').catch(() => 'down' as const));

export function useDepth(): DepthState {
  const [state, setState] = useState<DepthState>('loading');
  useEffect(() => {
    let live = true;
    void load().then((d) => live && setState(d));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** Basis points as a percentage with two decimals, sign dropped (how far, not which way). */
export const gapText = (bps: number): string => `${(Math.abs(bps) / 100).toFixed(2)}%`;
