// Live status under the headline (ui.hero "card"): each chain a crossing reaches, open both ways, one way only or
// paused (GET /api/health through core/route-claims.ts, the rows the network lists use; K6P1), the PUSD price and the Cauldron pools counted (GET /api/depth). Nothing is drawn for a
// reading that is missing: no zeros, no guesses (KJG4).
import { pegPrice } from '../../core/hero-chips';
import { routeOpenMap } from '../../core/client/health';
import { chipKey, routeClaims } from '../../core/route-claims';
import type { LoadedConfig } from './config';
import { useHealth } from './health';
import { useText } from './i18n';
import { useDepth } from './peg/usePeg';

export function HeroChips({ config, cross }: { config: LoadedConfig; cross: boolean }) {
  const { t } = useText();
  const health = useHealth();
  const depth = useDepth();
  const chains = cross ? routeClaims(config, routeOpenMap(health)) : [];
  const read = typeof depth === 'string' ? null : depth;
  const price = read ? pegPrice(read) : null;
  const known = health !== null && health.checkedAt !== null;
  const chips = [
    ...(known ? chains : []).map((c) => {
      const key = chipKey(c);
      return { id: `chain-${c.key}`, state: key === 'hero.chip.paused' ? 'paused' : 'open', text: t(key, { name: c.name }) };
    }),
    ...(read && price ? [{ id: 'price', state: 'info', text: t('hero.chip.price', { symbol: read.symbol, price }) }] : []),
    ...(read && read.pools > 0 ? [{ id: 'pools', state: 'info', text: t('hero.chip.pools', { count: String(read.pools) }) }] : []),
  ];
  if (chips.length === 0) return null;
  return (
    // Scrolls sideways on a narrow phone so the row stays one line; focusable so a keyboard can scroll it.
    <ul className="hero__chips" aria-label={t('hero.chips.label')} tabIndex={0}>
      {chips.map((c) => (
        <li key={c.id} className={`hero__chip hero__chip--${c.state}`} data-chip={c.id}>
          {c.text}
        </li>
      ))}
    </ul>
  );
}
