// Shown in place of a cross-chain form while no listed network is open (Bitcoin Cash halted, or every chain halted
// with no other route carrying it; KSG6). It lists each network with its state and when the page asks again, so the
// tab is never an empty panel; it gives way to the form by itself once a network reopens.
import type { Direction } from '../../../core/route-assets';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import { usePausedText } from './NetworkPicker';
import { useNetworkRows } from './useNetworks';
import './network.css';

export function RoutePaused({ config, direction }: { config: LoadedConfig; direction: Direction }) {
  const { t } = useText();
  const paused = usePausedText();
  const rows = useNetworkRows(config, direction);
  const route = t(`route.${config.route.active}` as TextKey);
  return (
    <div className="paused" role="status" data-paused="route">
      <p className="paused__title">{t('paused.route.title')}</p>
      <p className="paused__body">{t('paused.route.body', { route })}</p>
      {rows.length > 0 ? (
        <ul className="paused__chains">
          {rows.map((r) => (
            <li key={r.asset} className="paused__chain" data-asset={r.asset} data-status={r.open ? 'open' : 'paused'}>
              <span>{t('out.toAsset', { symbol: r.symbol, chain: r.chain.name })}</span>
              <span className="network__paused">{r.open ? t('health.ok') : paused(r)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="paused__body">{t('paused.route.recheck', { seconds: String(config.health.retrySeconds) })}</p>
    </div>
  );
}
