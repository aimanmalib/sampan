// The networks a crossing panel lists for its direction (KSG6, core/cross-choices networkStatus): every live one,
// each open or paused from the page's last health check. A chain that halts stays listed as paused and opens again
// when it reopens, without a reload; the chosen network falls back to the first open one while it is paused.
import { useState } from 'react';
import { routeOpenMap } from '../../../core/client/health';
import { networkStatus, type NetworkRow } from '../../../core/cross-choices';
import type { Direction } from '../../../core/route-assets';
import type { LoadedConfig } from '../config';
import { useHealth } from '../health';

export interface Networks {
  /** Every listed network, open or paused, in config order. */
  choices: NetworkRow[];
  /** The network the panel works with: the one chosen while it is open, else the first open one. */
  pick: NetworkRow | undefined;
  choose: (asset: string) => void;
}

/** The rows for a direction from the page's last health check. */
export function useNetworkRows(config: LoadedConfig, direction: Direction): NetworkRow[] {
  const health = useHealth();
  const oc = { enabled: config.features.oneClick, assets: config.oneClick.assets };
  return networkStatus(config.routeAssets, config.evm.chains, direction, routeOpenMap(health), oc);
}

export function useNetworks(config: LoadedConfig, direction: Direction): Networks {
  const choices = useNetworkRows(config, direction);
  const [chosen, setChosen] = useState<string | null>(null);
  const open = choices.filter((c) => c.open);
  const pick = open.find((c) => c.asset === chosen) ?? open[0];
  return { choices, pick, choose: setChosen };
}
