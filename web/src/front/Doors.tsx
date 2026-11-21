// Where to go next from the front page: the demo video and Sampan Pay, each only while its feature flag is on, and the
// risks page, each with the title and the sentence its own page opens with. Sits below the first screen and outside
// <main>, so the first screen still has no link to Sampan Pay (e2e/pay-live.spec.ts).
import type { LoadedConfig } from '../config';
import { useText } from '../i18n';

export function Doors({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  const symbol = config.tokens[config.defaultToken]?.symbol ?? '';
  const doors = [
    ...(config.features.demo ? [{ id: 'demo', href: '/demo', title: t('demo.title'), text: t('demo.lead') }] : []),
    ...(config.features.pay ? [{ id: 'pay', href: '/pay', title: t('pay.shop.title'), text: t('pay.shop.lead', { symbol }) }] : []),
    { id: 'risks', href: '/risks', title: t('legal.risks.title'), text: t('legal.risks.lead') },
  ];
  return (
    <div className="story__part doors">
      <ul className="story__in doors__list">
        {doors.map((d) => (
          <li key={d.id} className="door" data-door={d.id}>
            <h2 className="door__title">
              <a href={d.href}>
                {d.title}
                <svg className="door__arrow" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />
                </svg>
              </a>
            </h2>
            <p className="door__text">{d.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
