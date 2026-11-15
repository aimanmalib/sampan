// "Judging?" strip under the action card: the shortest real mainnet path, and one quiet button that opens the
// landing tab with the judge amount from config. Shown only while the landing flow is open.
import type { LoadedConfig } from './config';
import { useText } from './i18n';

export function JudgeStrip({ config, onFill }: { config: LoadedConfig; onFill: () => void }) {
  const { t } = useText();
  const symbol = config.tokens[config.defaultToken]?.symbol ?? '';
  return (
    <aside className="judge" aria-labelledby="judge-title">
      <p className="judge__title" id="judge-title">
        {t('judge.title')}
      </p>
      <ol className="judge__steps">
        <li>{t('judge.step1')}</li>
        <li>{t('judge.step2', { amount: config.limits.judgeLandBch, symbol })}</li>
      </ol>
      <button type="button" className="button button--quiet judge__fill" onClick={onFill}>
        {t('judge.fill')}
      </button>
      <p className="judge__note">{t('land.noWallet')}</p>
    </aside>
  );
}
