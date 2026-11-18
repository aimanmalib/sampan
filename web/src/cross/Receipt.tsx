// The receipt of a finished crossing out or in (/c/:id): every transaction in full with its explorer link, what went
// into the route and what came out, the cost and the share kept, and the time. Numbers from the server's receipt
// (core/receipt, server/api/receipt.ts); explorer hosts from config (core/client/explorer).
import { formatUsd } from '../../../core/cost';
import { fullTxid, txUrl } from '../../../core/client/explorer';
import { routeAmount, routeSymbol } from '../../../core/receipt';
import type { LoadedConfig } from '../config';
import { useText } from '../i18n';
import './receipt.css';

export interface ReceiptWire {
  legs: Array<{ chain: string; txid: string }>;
  refunded: boolean;
  paid: { asset: string; amount: string } | null;
  received: { asset: string; amount: string } | null;
  paidUsd: string | null;
  receivedUsd: string | null;
  costUsd: string | null;
  keepPct: number | null;
  seconds: number | null;
}

const coin = (c: { asset: string; amount: string }): string => {
  const symbol = routeSymbol(c.asset);
  return `${routeAmount(BigInt(c.amount), symbol === 'BCH' ? 0 : 2)} ${symbol}`;
};

export function Receipt({ r, config }: { r: ReceiptWire; config: LoadedConfig }) {
  const { t } = useText();
  const chainName = (chain: string): string => {
    const key = chain.toUpperCase();
    if (key === 'BCH') return t('receipt.chain.bch');
    if (key === 'THOR') return t('receipt.chain.thor');
    return config.evm.chains.find((c) => c.key.toUpperCase() === key)?.name ?? key;
  };
  const withUsd = (c: { asset: string; amount: string }, usd: string | null): string =>
    usd === null ? coin(c) : t('receipt.amountUsd', { amount: coin(c), usd: formatUsd(BigInt(usd)) });
  const stable = r.paid && routeSymbol(r.paid.asset) !== 'BCH' ? r.paid : r.received;
  return (
    <section className="receipt" aria-labelledby="receipt-title" data-testid="receipt">
      <h2 className="receipt__title" id="receipt-title">
        {t('receipt.title')}
      </h2>
      <ol className="receipt__legs">
        {r.legs.map((leg) => {
          const href = txUrl(config, leg.chain, leg.txid);
          const id = fullTxid(leg.chain, leg.txid);
          return (
            <li key={`${leg.chain}:${leg.txid}`} className="receipt__leg">
              <span className="receipt__chain">{chainName(leg.chain)}</span>
              {href ? (
                <a className="mono receipt__txid" href={href} target="_blank" rel="noreferrer">
                  {id}
                </a>
              ) : (
                <span className="mono receipt__txid">{id}</span>
              )}
            </li>
          );
        })}
      </ol>
      {r.paid && r.received ? (
        <dl className="receipt__sums">
          <div>
            <dt>{t('receipt.paid')}</dt>
            <dd data-testid="receipt-paid">{withUsd(r.paid, r.paidUsd)}</dd>
          </div>
          <div>
            <dt>{t(r.refunded ? 'receipt.refunded' : 'receipt.received')}</dt>
            <dd data-testid="receipt-received">{withUsd(r.received, r.receivedUsd)}</dd>
          </div>
          {r.costUsd !== null && r.keepPct !== null ? (
            <div>
              <dt>{t('receipt.cost')}</dt>
              <dd data-testid="receipt-cost">
                {t('receipt.costKept', { usd: formatUsd(BigInt(r.costUsd)), pct: r.keepPct.toFixed(2) })}
              </dd>
            </div>
          ) : null}
          {r.seconds !== null ? (
            <div>
              <dt>{t('receipt.time')}</dt>
              <dd data-testid="receipt-time">{t('receipt.minutes', { n: String(Math.max(1, Math.round(r.seconds / 60))) })}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {r.costUsd !== null && stable ? <p className="receipt__basis">{t('receipt.basis', { symbol: routeSymbol(stable.asset) })}</p> : null}
    </section>
  );
}
