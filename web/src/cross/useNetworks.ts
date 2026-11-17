// The networks a crossing panel offers: the live assets for its direction whose chain the route reports open in the
// page's last health check (KMR2). A chain that halts drops out of the list and comes back when it reopens, without a
// reload; the chosen network falls back to the first one offered when it drops out.
import { useState } from 'react';
import { openChoices, type Direction, type RouteChoice } from '../../../core/route-assets';
import type { LoadedConfig } from '../config';
import { useHealth } from '../health';

export interface Networks {
  choices: RouteChoice[];
  pick: RouteChoice | undefined;
  choose: (asset: string) => void;
}

export function useNetworks(config: LoadedConfig, direction: Direction): Networks {
  const health = useHealth();
  const [chosen, setChosen] = useState<string | null>(null);
  const choices = openChoices(config.routeAssets, config.evm.chains, direction, health?.route?.chains);
  const pick = choices.find((c) => c.asset === chosen) ?? choices[0];
  return { choices, pick, choose: setChosen };
}
