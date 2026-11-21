// The connected wallet's balance at the top right (features.headerBalance, K5P6): BCH and each offered stablecoin from
// the wallet scan the panels already use. Hidden until a wallet is connected and scanned. It scans again after every
// transaction (the panels call wallet.refresh) and every wallet.balancePollMs while the tab is visible and no dialog
// is open. A click opens the Swap tab, where the full balance and Disconnect are.
import { useEffect } from 'react';
import { tokenOffered } from '../../../core/config';
import type { LoadedConfig } from '../config';
import { useText } from '../i18n';
import { refreshBlocked } from '../quote/refresh';
import { balanceLines } from './balance';
import type { Wallet } from './useWallet';
import './balance.css';

export function BalancePill({ config, wallet, onOpen }: { config: LoadedConfig | null; wallet: Wallet; onOpen: (() => void) | null }) {
  const { t } = useText();
  const on = config?.features.headerBalance === true && wallet.session !== null;
  useBalancePoll(on ? (config?.balance.pollMs ?? 0) : 0, wallet.refresh);
  if (!config || !on || !wallet.view) return null;
  const tokens = Object.values(config.tokens).filter((tk) => tokenOffered(config, tk.symbol));
  const lines = balanceLines(wallet.view, tokens, config.balance.bchDecimals);
  const label = t('wallet.pill.label', {
    amounts: lines.map((l) => `${l.amount} ${l.unit}`).join(` ${t('text.and')} `),
    tab: t('tabs.swap'),
  });
  const body = lines.map((l) => (
    <span key={l.unit} className="balance__line">
      <span className="balance__amount">{l.amount}</span> <span className="balance__unit">{l.unit}</span>
    </span>
  ));
  // Off the front page there is no Swap tab: the link goes home, where the default tab shows the wallet.
  return onOpen ? (
    <button type="button" className="balance" aria-label={label} onClick={onOpen}>
      {body}
    </button>
  ) : (
    <a className="balance" aria-label={label} href="/">
      {body}
    </a>
  );
}

/** Calls `refresh` every `ms` while the tab is visible and no dialog is open (a wallet prompt keeps its coins). */
function useBalancePoll(ms: number, refresh: () => void): void {
  useEffect(() => {
    if (ms <= 0) return;
    let timer = setTimeout(function tick() {
      if (!refreshBlocked(document)) refresh();
      timer = setTimeout(tick, ms);
    }, ms);
    return () => clearTimeout(timer);
  }, [ms, refresh]);
}
