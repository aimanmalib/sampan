import { Mark } from './brand/Brand';
import { useConfig } from './config';
import { HealthStrip } from './HealthStrip';
import { useText } from './i18n';
import { SceneArt } from './SceneArt';

export function Footer() {
  const { lang, t } = useText();
  const config = useConfig();
  const machine = config?.i18n.languages.find((l) => l.code === lang)?.machine === true;
  return (
    <footer className="footer">
      <div className="footer__in">
        <div className="footer__top">
          <div className="footer__brand">
            <Mark />
            <p className="footer__lead">{t('footer.sampan')}</p>
          </div>
          {/* The boat between the two jetties, as on the front page, at rest; decoration here. */}
          <div className="footer__scene">
            <SceneArt viewBox="150 62 340 96" fit="slice" sky />
          </div>
        </div>
        <HealthStrip />
        {machine ? <p className="footer__machine">{t('lang.machine')}</p> : null}
        <p className="footer__meta">
          <span>{t('footer.built')}</span> <span>{t('footer.license')}</span>
          <a href="/how">{t('footer.how')}</a>
          <a href="/faq">{t('footer.faq')}</a>
          <a href="/activity">{t('footer.activity')}</a>
          {config?.features.demo ? <a href="/demo">{t('footer.demo')}</a> : null}
          <a href="/terms">{t('footer.terms')}</a>
          <a href="/risks">{t('footer.risks')}</a>
          {config?.features.pay ? <a href="/pay">{t('footer.merchants')}</a> : null}
          {config?.banner.repoUrl ? <a href={config.banner.repoUrl}>{t('footer.repo')}</a> : null}
          {config?.site.feedbackUrl ? <a href={config.site.feedbackUrl}>{t('footer.feedback')}</a> : null}
        </p>
      </div>
    </footer>
  );
}
