// One real crossing by the card (K6P6): the newest ok stablecoin crossing into PUSD in docs/MEASURED.md, as it was when
// the page was built (virtual:sampan-proof), picked by core/hero-proof.ts. Amount and asset from the row, chain name
// and explorers from config, both transactions linked, and the table of every run on /how. config.ui.heroProof "none"
// draws nothing.
import proof from 'virtual:sampan-proof';
import { heroProof } from '../../core/hero-proof';
import { duration } from '../../core/route-facts-text';
import type { LoadedConfig } from './config';
import { runText } from './how/txLinks';
import { useText, type TextKey } from './i18n';
import './hero-proof.css';

export function HeroProof({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  const run = heroProof(proof, config.route.symbols, config.ui.heroProof);
  if (!run) return null;
  const { chainName, href } = runText(config, t);
  const text = (key: string, vars?: Record<string, string>): string => t(key as TextKey, vars);
  const vars = { amount: run.amount, symbol: run.symbol, chain: chainName(run.chain) };
  const line =
    run.seconds === null ? t('heroProof.lineNoTime', vars) : t('heroProof.line', { ...vars, time: duration(run.seconds, text) });
  return (
    <p className="hero-proof" data-hero-proof={run.bch.id} tabIndex={0}>
      <span className="hero-proof__label">{t('heroProof.label')}</span> {line}{' '}
      <span className="hero-proof__links">
        <a href={href(run.bch)} target="_blank" rel="noreferrer" title={run.bch.id}>
          {t('heroProof.tx', { chain: chainName('bch') })}
        </a>
        {' · '}
        <a href={href(run.evm)} target="_blank" rel="noreferrer" title={run.evm.id}>
          {t('heroProof.tx', { chain: run.symbol })}
        </a>
        {' · '}
        <a href="/how#proof">{t('heroProof.all')}</a>
      </span>
    </p>
  );
}
