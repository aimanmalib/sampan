// /pay/i/:id: the page a customer pays an invoice on. Address, QR code and BIP21 link with the amount in BCH, the
// time left, the status as it changes (the page asks again every landing.pagePollSeconds) and the transactions.
// Each status gets plain words about where the money went (invoice-state.ts). For a demo shop order the page also
// shows whether the shop's server has checked the signed webhook and handed the order over.
import { useCallback, useEffect, useState } from 'react';
import { ApiFailure } from '../../../core/client/api';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import { PayQr } from '../land/PayQr';
import { bch, countdown, dueSats, isDemo, keepAsking, payable, statusLine, type InvoiceView } from './invoice-state';

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'error' } | { state: 'ok'; view: InvoiceView };

const short = (txid: string): string => `${txid.slice(0, 10)}…${txid.slice(-8)}`;

function TxLinks({ label, txids, config }: { label: string; txids: string[]; config: LoadedConfig | null }) {
  if (txids.length === 0) return null;
  return (
    <p className="payinv__tx">
      <span>{label} </span>
      {txids.map((txid, i) => (
        <span key={txid}>
          {i > 0 ? ', ' : null}
          {config ? (
            <a className="mono" href={config.connect.explorerTxUrl.replace('{txid}', txid)} target="_blank" rel="noreferrer">
              {short(txid)}
            </a>
          ) : (
            <span className="mono">{short(txid)}</span>
          )}
        </span>
      ))}
    </p>
  );
}

function PayBox({ view, now }: { view: InvoiceView; now: number }) {
  const { t } = useText();
  const [copied, setCopied] = useState(false);
  const due = dueSats(view);
  const amount = bch(due);
  const link = `${view.address}?amount=${amount}`;
  return (
    <div className="payinv__box">
      <PayQr value={link} label={t('pay.inv.qrLabel', { amount })} />
      <div className="payinv__details">
        <p className="payinv__amount">
          <span className="payinv__label">{t('pay.inv.amount')}</span>
          <span className="payinv__bch mono">{amount} BCH</span>
        </p>
        <p className="payinv__address mono">{view.address}</p>
        <div className="payinv__buttons">
          <a className="button button--primary payinv__open" href={link}>
            {t('pay.inv.openWallet')}
          </a>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => void navigator.clipboard?.writeText(view.address).then(() => setCopied(true), () => setCopied(false))}
          >
            {copied ? t('land.copied') : t('land.copy')}
          </button>
        </div>
        <p className="payinv__time" role="timer">
          {t('pay.inv.timeLeft', { time: countdown(Date.parse(view.expiresAt) - now) })}
        </p>
      </div>
    </div>
  );
}

export function InvoicePage({ id, config }: { id: string; config: LoadedConfig | null }) {
  const { t } = useText();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [demoFulfilled, setDemoFulfilled] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const symbol = config?.tokens[config.defaultToken]?.symbol ?? '';

  const check = useCallback(() => {
    api
      .get<InvoiceView>(`/api/pay/invoice/${id}`)
      .then((view) => {
        setLoad({ state: 'ok', view });
        if (isDemo(view)) {
          api.get<{ fulfilled: boolean }>(`/api/pay/demo/order/${id}`).then((o) => setDemoFulfilled(o.fulfilled), () => undefined);
        }
      })
      .catch((e: unknown) => setLoad((prev) => (prev.state === 'ok' ? prev : { state: e instanceof ApiFailure && e.status === 404 ? 'missing' : 'error' })));
  }, [id]);
  useEffect(() => check(), [check]);

  const view = load.state === 'ok' ? load.view : null;
  const open = view ? payable(view, now) : false;
  const asking = view ? keepAsking(view, now, demoFulfilled) : false;
  const pollMs = (config?.landing.pagePollSeconds ?? 10) * 1000;

  // The clock for the countdown runs only while the address can still be paid.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  // Ask again while something can still change; once more when the time runs out.
  useEffect(() => {
    if (!asking) return;
    const timer = setInterval(check, pollMs);
    return () => clearInterval(timer);
  }, [asking, check, pollMs]);
  const expiresAt = view ? Date.parse(view.expiresAt) : 0;
  useEffect(() => {
    if (!expiresAt) return;
    const wait = expiresAt - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(check, wait + 500);
    return () => clearTimeout(timer);
  }, [expiresAt, check]);

  if (load.state !== 'ok' || !view) {
    return (
      <section className="payinv">
        <h1 className="payinv__title">{t('pay.shop.title')}</h1>
        {load.state === 'missing' ? <p role="alert">{t('pay.inv.missing')}</p> : null}
        {load.state === 'error' ? <p role="alert">{t('pay.inv.error')}</p> : null}
      </section>
    );
  }

  const { line, vars } = statusLine(view, now);
  const demo = isDemo(view);
  return (
    <section className="payinv">
      {demo ? <p className="payinv__badge">{t('pay.inv.demo')}</p> : null}
      <h1 className="payinv__title">{t('pay.inv.title', { usd: view.usd })}</h1>
      {open ? (
        <>
          <p className="payinv__lead">{t('pay.inv.lead', { symbol })}</p>
          <PayBox view={view} now={now} />
        </>
      ) : null}
      <p className={`payinv__status payinv__status--${line}`} aria-live="polite">
        {t(`pay.inv.status.${line}` as TextKey, { ...vars, symbol })}
      </p>
      {demo && demoFulfilled !== null && (view.status === 'paid' || view.status === 'overpaid' || view.status === 'paid_late') ? (
        <p className={`payinv__order${demoFulfilled ? ' payinv__order--done' : ''}`} aria-live="polite">
          {t(demoFulfilled ? 'pay.inv.order.fulfilled' : 'pay.inv.order.waiting')}
        </p>
      ) : null}
      <TxLinks label={t('pay.inv.payment')} txids={view.payments.map((p) => p.txid)} config={config} />
      <TxLinks label={t('pay.inv.convert')} txids={view.convert.map((c) => c.txid)} config={config} />
      <p className="payinv__actions">
        <button type="button" className="button button--quiet" onClick={check}>
          {t('crossing.check')}
        </button>
        {view.returnUrl ? <a href={demo ? '/pay' : view.returnUrl}>{t('pay.inv.back')}</a> : null}
      </p>
    </section>
  );
}
