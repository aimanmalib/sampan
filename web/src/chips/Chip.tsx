// Icon chips: a token or chain name with its icon. Which icon goes with which name is config ui.icons (name → a file
// in web/src/icons/); a name with no icon gets a one-letter monogram. The icon is decoration: the name is the text.
import type { LoadedConfig } from '../config';
import { UsdValue } from './UsdValue';
import './chips.css';

const FILES = import.meta.glob<string>('../icons/*.svg', { eager: true, query: '?url', import: 'default' });

/** The URL of the icon config maps `name` to, or undefined (no entry, or no such file). */
export function iconUrl(icons: Record<string, string>, name: string): string | undefined {
  const file = icons[name];
  return file ? FILES[`../icons/${file}.svg`] : undefined;
}

export function ChipIcon({ config, name }: { config: LoadedConfig; name: string }) {
  const url = iconUrl(config.ui.icons, name);
  return url ? (
    <img className="chip__icon" src={url} alt="" width="20" height="20" aria-hidden="true" />
  ) : (
    <span className="chip__icon chip__mono" aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

/** The unit beside an amount: icon and symbol, with the amount's dollar value under it when the page knows it. */
export function UnitChip({ config, name, usd }: { config: LoadedConfig; name: string; usd?: number | undefined }) {
  return (
    <span className="field__side">
      <span className="field__unit chip">
        <ChipIcon config={config} name={name} />
        {name}
      </span>
      <UsdValue usd={usd} />
    </span>
  );
}
