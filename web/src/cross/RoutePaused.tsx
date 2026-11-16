// Shown in place of a cross-chain form while the server's last health check saw the route halted.
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';

export function RoutePaused({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  const route = t(`route.${config.route.active}` as TextKey);
  return (
    <div className="paused" role="status" data-paused="route">
      <p className="paused__title">{t('paused.route.title')}</p>
      <p className="paused__body">{t('paused.route.body', { route })}</p>
    </div>
  );
}
