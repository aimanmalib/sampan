import { useConfig } from './config';
import { useText } from './i18n';

export function Footer() {
  const { t } = useText();
  const config = useConfig();
  return (
    <footer className="footer">
      <p className="footer__lead">{t('footer.sampan')}</p>
      <p className="footer__meta">
        <span>{t('footer.built')}</span> <span>{t('footer.license')}</span>
        {config?.banner.repoUrl ? <a href={config.banner.repoUrl}>{t('footer.repo')}</a> : null}
        {config?.site.feedbackUrl ? <a href={config.site.feedbackUrl}>{t('footer.feedback')}</a> : null}
      </p>
    </footer>
  );
}
