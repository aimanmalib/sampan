// Tab "Bring in": the landing address ("BCH from any wallet") and, when crossings are open, a stablecoin from another
// chain. Each source shows only when its flow flag is on; with one source there is no chooser.
import { useState } from 'react';
import { openFlows, symbolList } from '../../../core/flows';
import { routeChoices } from '../../../core/route-assets';
import type { LoadedConfig } from '../config';
import { useText } from '../i18n';
import { LandPanel } from '../land/LandPanel';
import type { Wallet } from '../wallet/useWallet';
import { RoutePaused } from '../cross/RoutePaused';
import { InPanel } from './InPanel';

type Source = 'land' | 'cross';

/** `halted`: the route reports a halt, so the cross-chain source shows "Paused by the route" instead of its form. */
export function BringIn({ config, wallet, halted }: { config: LoadedConfig; wallet: Wallet; halted: boolean }) {
  const { t } = useText();
  const flows = openFlows(config);
  const sources: Source[] = [...(flows.land ? (['land'] as const) : []), ...(flows.cross ? (['cross'] as const) : [])];
  const [chosen, setChosen] = useState<Source | null>(null);
  const source = chosen && sources.includes(chosen) ? chosen : sources[0];
  if (!source) return null;
  // Named from the assets live for bringing in: one chain by name, several as "other chains" (the tab stays short).
  const live = routeChoices(config.routeAssets, config.evm.chains, 'in');
  const symbols = symbolList([...new Set(live.map((c) => c.symbol))], t('text.and'));
  const chains = [...new Set(live.map((c) => c.chain.name))];
  const crossLabel = chains.length > 1 ? t('in.source.crossMany', { symbols }) : t('in.source.cross', { symbol: symbols, chain: chains[0] ?? '' });
  return (
    <>
      {sources.length > 1 ? (
        <div className="swap__sides in__sources" role="radiogroup" aria-label={t('in.source')}>
          {sources.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={source === s} className="swap__side" onClick={() => setChosen(s)}>
              {s === 'land' ? t('land.source') : crossLabel}
            </button>
          ))}
        </div>
      ) : null}
      {source === 'land' ? (
        <LandPanel config={config} wallet={wallet} />
      ) : halted ? (
        <RoutePaused config={config} />
      ) : (
        <InPanel config={config} wallet={wallet} />
      )}
    </>
  );
}
