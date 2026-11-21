// "Right now" on the front page: the river as it is at this moment. Every chain a crossing reaches is a mooring on the
// far bank; its lane across the water says what can be brought in and sent out now and which route carries it, and
// Bitcoin Cash is the bank they all land on. The rows are the ones the hero chips and the network lists read
// (core/route-claims.ts over GET /api/health), the peg line is GET /api/depth. Until the first health check has
// answered nothing is drawn: no guesses (KJG4). It is a table for a screen reader and on a phone a plain list
// (harbour.css); only a wide screen lays it out as the river.
import { routeOpenMap } from '../../../core/client/health';
import { pegPrice } from '../../../core/hero-chips';
import { chipKey, routeClaims } from '../../../core/route-claims';
import { ChipIcon } from '../chips/Chip';
import type { LoadedConfig } from '../config';
import { useHealth } from '../health';
import { useText, type TextKey } from '../i18n';
import { useDepth } from '../peg/usePeg';
import './harbour.css';

export function Harbour({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  const health = useHealth();
  const depth = useDepth();
  if (health === null || health.checkedAt === null) return null;
  const claims = routeClaims(config, routeOpenMap(health));
  if (claims.length === 0) return null;
  const read = typeof depth === 'string' ? null : depth;
  const price = read ? pegPrice(read) : null;
  const symbol = config.tokens[config.defaultToken]?.symbol ?? '';
  /** One direction of a lane: the symbols and the wake they leave, or a dash when nothing crosses that way now. */
  const lane = (way: 'in' | 'out', symbols: string[]) => (
    <td className={symbols.length > 0 ? `board__lane board__lane--${way}` : `board__lane board__lane--${way} board__lane--none`} data-label={t(`tabs.${way}`)}>
      <span className="board__what">{symbols.length > 0 ? symbols.join(' · ') : t('proof.none')}</span>
      <span className="board__wake" aria-hidden="true" />
    </td>
  );
  return (
    <section className="story__part harbour" id="now" aria-labelledby="harbour-title">
      <div className="story__in">
        <h2 className="story__title" id="harbour-title">
          {t('hero.chips.label')}
        </h2>
        <div className="harbour__map">
          <table className="board">
            <thead>
              <tr>
                <th scope="col">{t('cross.network')}</th>
                <th scope="col">{t('tabs.in')}</th>
                <th scope="col">{t('tabs.out')}</th>
                <th scope="col">{t('review.route')}</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => {
                const key = chipKey(c);
                return (
                  <tr key={c.key} className={key === 'hero.chip.paused' ? 'board__row board__row--paused' : 'board__row'} data-board={c.key}>
                    <th scope="row">
                      <span className="board__net">
                        <ChipIcon config={config} name={c.key} />
                        <span>{t(key, { name: c.name })}</span>
                      </span>
                    </th>
                    {lane('in', c.in)}
                    {lane('out', c.out)}
                    <td className="board__route" data-label={t('review.route')}>
                      <span className={c.via.length > 0 ? 'board__via' : 'board__via board__via--none'}>
                        {c.via.length > 0 ? c.via.map((r) => t(`route.${r}` as TextKey)).join(' · ') : t('proof.none')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* The near bank, once for every lane (a wide screen only). */}
          <p className="harbour__home">
            <ChipIcon config={config} name="BCH" />
            <span>
              {t('how.cross.d.bch')} · {symbol}
            </span>
          </p>
        </div>
        {read && (price || read.pools > 0) ? (
          <p className="harbour__peg">
            {price ? <span>{t('hero.chip.price', { symbol: read.symbol, price })}</span> : null}
            {read.pools > 0 ? <span>{t('hero.chip.pools', { count: String(read.pools) })}</span> : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}
