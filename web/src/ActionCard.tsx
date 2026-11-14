import { useState } from 'react';
import type { LoadedConfig } from './config';
import { useText, type TextKey } from './i18n';
import { SwapPanel } from './swap/SwapPanel';
import { ConnectDialog } from './wallet/ConnectDialog';
import type { Wallet } from './wallet/useWallet';

const TABS = [
  { id: 'swap', label: 'tabs.swap' },
  { id: 'out', label: 'tabs.out' },
  { id: 'in', label: 'tabs.in' },
] as const satisfies readonly { id: string; label: TextKey }[];

type TabId = (typeof TABS)[number]['id'];

/** The single action card. A flow shows only when its feature flag is on (it has been measured on mainnet). */
export function ActionCard({ config, wallet }: { config: LoadedConfig | null; wallet: Wallet }) {
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
        {tab === 'swap' && config?.features.swap ? (
          <SwapPanel config={config} wallet={wallet} />
        ) : (
          <>
            <p className="card__note">{t('card.notOpen')}</p>
            <button type="button" className="button button--primary" disabled>
              {t('card.connect')}
            </button>
          </>
        )}
      </div>
      {wallet.status === 'connecting' && wallet.uri && wallet.qrUri ? (
        <ConnectDialog uri={wallet.uri} qrUri={wallet.qrUri} onClose={() => void wallet.disconnect()} />
      ) : null}
    </section>
  );
}
