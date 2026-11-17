// "Network": one native radio per stablecoin and chain the panel offers, so arrow keys move between them. With one
// network there is nothing to choose and the panel shows its own sentence instead.
import { useId } from 'react';
import type { RouteChoice } from '../../../core/route-assets';
import { useText } from '../i18n';
import './network.css';

export function NetworkPicker({ choices, value, onChange, disabled }: { choices: RouteChoice[]; value: string | undefined; onChange: (asset: string) => void; disabled: boolean }) {
  const { t } = useText();
  const name = useId();
  return (
    <fieldset className="network" disabled={disabled}>
      <legend className="field__label">{t('cross.network')}</legend>
      <div className="network__rows">
        {choices.map((c) => (
          <label key={c.asset} className="network__row" data-asset={c.asset}>
            <input type="radio" className="network__radio" name={name} value={c.asset} checked={c.asset === value} onChange={() => onChange(c.asset)} />
            <span>{t('out.toAsset', { symbol: c.symbol, chain: c.chain.name })}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
