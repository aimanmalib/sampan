// "Network": one native radio per stablecoin and chain the panel lists, so arrow keys move between them. A network
// no route carries now stays in the list with its radio off and a pill naming the route that paused it (KSG6). With
// one network there is nothing to choose and the panel shows its own sentence instead.
import { useId } from 'react';
import type { NetworkRow } from '../../../core/cross-choices';
import { ChipIcon } from '../chips/Chip';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import './network.css';

/** "Paused by THORChain" for a paused row: the route names come from the language files. */
export function usePausedText(): (row: NetworkRow) => string {
  const { t } = useText();
  return (row) => t('cross.network.paused', { route: row.pausedBy.map((r) => t(`route.${r}` as TextKey)).join(', ') });
}

export function NetworkPicker({
  config,
  choices,
  value,
  onChange,
  disabled,
}: {
  config: LoadedConfig;
  choices: NetworkRow[];
  value: string | undefined;
  onChange: (asset: string) => void;
  disabled: boolean;
}) {
  const { t } = useText();
  const paused = usePausedText();
  const name = useId();
  return (
    <fieldset className="network" disabled={disabled}>
      <legend className="field__label">{t('cross.network')}</legend>
      <div className="network__rows">
        {choices.map((c) => (
          <label key={c.asset} className={`network__row${c.open ? '' : ' network__row--paused'}`} data-asset={c.asset} data-status={c.open ? 'open' : 'paused'}>
            <input
              type="radio"
              className="network__radio"
              name={name}
              value={c.asset}
              checked={c.open && c.asset === value}
              disabled={!c.open}
              aria-disabled={!c.open}
              onChange={() => onChange(c.asset)}
            />
            <span className="network__icons">
              <ChipIcon config={config} name={c.symbol} />
              <ChipIcon config={config} name={c.chain.key} />
            </span>
            <span className="network__name">{t('out.toAsset', { symbol: c.symbol, chain: c.chain.name })}</span>
            {c.open ? null : <span className="network__paused">{paused(c)}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
