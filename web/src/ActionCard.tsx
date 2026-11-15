import { useState, type ReactNode } from 'react';
import { openFlows, openTabs, type TabId } from '../../core/flows';
import type { LoadedConfig } from './config';
import { useText, type TextKey } from './i18n';
import { SwapPanel } from './swap/SwapPanel';
import { ConnectDialog } from './wallet/ConnectDialog';
import type { Wallet } from './wallet/useWallet';

const LABELS: Record<TabId, TextKey> = { swap: 'tabs.swap', out: 'tabs.out', in: 'tabs.in' };

type Panel = (props: { config: LoadedConfig; wallet: Wallet }) => ReactNode;

/** Tabs with a working panel. A tab is listed only when its flow flag is on and its panel exists. */
const PANELS: Partial<Record<TabId, Panel>> = {
  swap: ({ config, wallet }) => <SwapPanel config={config} wallet={wallet} />,
};

/**
 * The single action card. A flow shows only when its feature flag is on (it has been measured on mainnet);
 * a closed flow has no tab at all. With no open flow the card is not drawn.
 */
export function ActionCard({ config, wallet }: { config: LoadedConfig | null; wallet: Wallet }) {
  const { t } = useText();
  const tabs = openTabs(openFlows(config)).filter((id) => PANELS[id]);
  const [chosen, setChosen] = useState<TabId | null>(null);
  const tab = chosen && tabs.includes(chosen) ? chosen : tabs[0];
  const Body = tab ? PANELS[tab] : undefined;
  if (!config || !tab || !Body) return null;
  return (
    <section className="card" aria-label={t('tabs.label')}>
      <div className="tabs" role="tablist" aria-label={t('tabs.label')}>
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls="tab-panel"
            className="tabs__tab"
            onClick={() => setChosen(id)}
          >
            {t(LABELS[id])}
          </button>
        ))}
      </div>
      <div className="card__body" role="tabpanel" id="tab-panel" aria-labelledby={`tab-${tab}`}>
        <Body config={config} wallet={wallet} />
      </div>
      {wallet.status === 'connecting' && wallet.uri && wallet.qrUri ? (
        <ConnectDialog uri={wallet.uri} qrUri={wallet.qrUri} onClose={() => void wallet.disconnect()} />
      ) : null}
    </section>
  );
}
