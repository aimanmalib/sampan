// The networks a crossing panel offers: THORChain's live assets for its direction whose chain it reports open in the
// page's last health check (KMR2), plus 1Click's live assets whatever THORChain reports (KSG3, core/cross-choices).
// A chain that halts drops out of the list and comes back when it reopens, without a reload; the chosen network falls
// back to the first one offered when it drops out.
import { useState } from 'react';
import { crossChoices, type CrossChoice } from '../../../core/cross-choices';
import type { Direction } from '../../../core/route-assets';
import type { LoadedConfig } from '../config';
import { useHealth } from '../health';

export interface Networks {
  choices: CrossChoice[];
  pick: CrossChoice | undefined;
  choose: (asset: string) => void;
}

export function useNetworks(config: LoadedConfig, direction: Direction): Networks {
  const health = useHealth();
  const [chosen, setChosen] = useState<string | null>(null);
  const oc = { enabled: config.features.oneClick, assets: config.oneClick.assets };
  const choices = crossChoices(config.routeAssets, config.evm.chains, direction, health?.route?.chains, oc);
  const pick = choices.find((c) => c.asset === chosen) ?? choices[0];
  return { choices, pick, choose: setChosen };
}
