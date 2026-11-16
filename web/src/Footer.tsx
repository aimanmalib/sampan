import { useConfig } from './config';
import { HealthStrip } from './HealthStrip';
import { useText } from './i18n';

export function Footer() {
  const { t } = useText();
  const config = useConfig();
  return (
    <footer className="footer">
      <HealthStrip />
      <p className="footer__lead">{t('footer.sampan')}</p>
      <p className="footer__meta">
        <span>{t('footer.built')}</span> <span>{t('footer.license')}</span>
        <a href="/how">{t('footer.how')}</a>
        <a href="/terms">{t('footer.terms')}</a>
        <a href="/risks">{t('footer.risks')}</a>
        {config?.features.pay ? <a href="/pay">{t('footer.merchants')}</a> : null}
        {config?.banner.repoUrl ? <a href={config.banner.repoUrl}>{t('footer.repo')}</a> : null}
        {config?.site.feedbackUrl ? <a href={config.site.feedbackUrl}>{t('footer.feedback')}</a> : null}
      </p>
    </footer>
  );
}
