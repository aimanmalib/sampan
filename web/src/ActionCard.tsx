import { useState } from 'react';
import { useText, type TextKey } from './i18n';

const TABS = [
  { id: 'swap', label: 'tabs.swap' },
  { id: 'out', label: 'tabs.out' },
  { id: 'in', label: 'tabs.in' },
] as const satisfies readonly { id: string; label: TextKey }[];

type TabId = (typeof TABS)[number]['id'];

/** The single action card. Flows are added tab by tab; until a flow is measured on mainnet its button stays disabled. */
export function ActionCard() {
  const { t } = useText();
  const [tab, setTab] = useState<TabId>('swap');
  return (
    <section className="card" aria-label={t('tabs.label')}>
      <div className="tabs" role="tablist" aria-label={t('tabs.label')}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls="tab-panel"
            className="tabs__tab"
            onClick={() => setTab(item.id)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      <div className="card__body" role="tabpanel" id="tab-panel" aria-labelledby={`tab-${tab}`}>
        <p className="card__note">{t('card.notOpen')}</p>
        <button type="button" className="button button--primary" disabled>
          {t('card.connect')}
        </button>
      </div>
    </section>
  );
}
