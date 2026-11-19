// The stablecoin of the Swap tab when config offers more than one (MUSD behind features.musd). One offered token =
// nothing is drawn and the tab stays as it was.
import { useText } from '../i18n';
import type { LoadedConfig } from '../config';

export function TokenPick({ config, value, disabled, onPick }: { config: LoadedConfig; value: string; disabled: boolean; onPick: (symbol: string) => void }) {
  const { t } = useText();
  const symbols = Object.keys(config.tokens);
  if (symbols.length < 2) return null;
  return (
    <div className="swap__sides" role="radiogroup" aria-label={t('swap.token')}>
      {symbols.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} className="swap__side" disabled={disabled} onClick={() => onPick(s)}>
          {config.tokens[s]!.symbol}
        </button>
      ))}
    </div>
  );
}
