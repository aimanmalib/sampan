// "Cauldron ok · Bitcoin Cash ok · THORChain ok": the server's own last check, shown above the footer text.
import { Fragment } from 'react';
import { healthParts } from '../../core/client/health';
import { useHealth } from './health';
import { useText, type TextKey } from './i18n';

export function HealthStrip() {
  const { t } = useText();
  const parts = healthParts(useHealth(), t, (id) => t(`route.${id}` as TextKey));
  if (parts.length === 0) return null;
  return (
    <p className="health" aria-label={t('health.label')}>
      {parts.map((p, i) => (
        <Fragment key={p.id}>
          {i > 0 ? <span aria-hidden="true"> · </span> : null}
          <span className={`health__part health__part--${p.state}`} data-health={p.id}>
            {p.text}
          </span>
        </Fragment>
      ))}
    </p>
  );
}
