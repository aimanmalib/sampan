// Under the action card: names the provider the server's last health check saw not answering (Cauldron, Bitcoin Cash,
// the route), so a failed step comes with its reason. A halted route has its own "Paused by the route" panel.
// Nothing is drawn while every provider answers.
import { healthParts } from '../../../core/client/health';
import { useHealth } from '../health';
import { useText, type TextKey } from '../i18n';

export function ProviderNote() {
  const { t } = useText();
  const down = healthParts(useHealth(), t, (id) => t(`route.${id}` as TextKey)).filter((p) => p.state === 'down');
  if (down.length === 0) return null;
  return <p className="provider-note" role="status">{t('error.provider', { names: down.map((p) => p.name).join(', ') })}</p>;
}
