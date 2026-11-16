// /pay: Sampan Pay for merchants. A demo shop with one order at pay.demo.priceUsd (paid to the project's test
// wallet, fulfilled by its own signed webhook) with its button on the first screen, then the API in four short
// parts with samples built from config.
import { useState } from 'react';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import { useText } from '../i18n';
import { buttonSnippet, createSnippet, statusSnippet, webhookSnippet } from './snippets';

function Sample({ code, label }: { code: string; label: string }) {
  return (
    <pre className="payshop__code mono" aria-label={label} tabIndex={0}>
      <code>{code}</code>
    </pre>
  );
}

export function ShopPage({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const symbol = config.tokens[config.defaultToken]?.symbol ?? '';
  const price = config.pay.demoPriceUsd.toFixed(2);
  const origin = location.origin;
  const sample = t('pay.shop.snippetLabel');

  const buy = (): void => {
    setBusy(true);
    setFailed(false);
    api
      .post<{ statusUrl: string }>('/api/pay/demo/order', {})
      .then((order) => location.assign(order.statusUrl))
      .catch(() => {
        setFailed(true);
        setBusy(false);
      });
  };

  return (
    <section className="payshop">
      <p className="how__back">
        <a href="/">{t('how.back')}</a>
      </p>
      <h1 className="payshop__title">{t('pay.shop.title')}</h1>
      <p className="payshop__lead">{t('pay.shop.lead', { symbol })}</p>

      <h2 className="payshop__h2">{t('pay.shop.demoTitle')}</h2>
      <div className="card payshop__card">
        <div className="card__body">
          <p className="payshop__product">
            <span>{t('pay.shop.product')}</span>
            <span className="payshop__price">{t('pay.shop.price', { price })}</span>
          </p>
          {failed ? (
            <p className="swap__error" role="alert">
              {t('pay.shop.err')}
            </p>
          ) : null}
          <button type="button" className="button button--primary" disabled={busy} onClick={buy}>
            {busy ? t('pay.shop.buying') : t('pay.shop.buy')}
          </button>
          <p className="card__note">{t('pay.shop.productNote')}</p>
          <p className="card__note">{t('pay.shop.demoNote', { price })}</p>
        </div>
      </div>
      <p className="payshop__limits">
        {t('pay.shop.limits', { min: config.pay.minUsd.toFixed(2), max: String(config.pay.maxUsd), minutes: String(config.pay.validMinutes) })}
      </p>

      <h2 className="payshop__h2">{t('pay.shop.apiTitle')}</h2>
      <ol className="payshop__api">
        <li>
          <p>{t('pay.shop.api.create')}</p>
          <Sample code={createSnippet(origin, config.pay.demoPriceUsd)} label={sample} />
        </li>
        <li>
          <p>{t('pay.shop.api.status')}</p>
          <Sample code={statusSnippet(origin)} label={sample} />
        </li>
        <li>
          <p>{t('pay.shop.api.webhook')}</p>
          <Sample code={webhookSnippet()} label={sample} />
        </li>
        <li>
          <p>{t('pay.shop.api.button')}</p>
          <Sample code={buttonSnippet(origin, t('pay.shop.buy'))} label={sample} />
          <p>
            <a href="/pay/example.html">{t('pay.shop.example')}</a>
          </p>
        </li>
      </ol>
    </section>
  );
}
