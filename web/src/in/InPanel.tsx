// "Bring in" from another chain (flow C, route B): the user's EVM wallet signs an exact approval (when needed) and
// the router deposit. Before the wallet opens, this page checks the plan (memo destination and limit; a landing
// address recomputed from its card) and says in plain words what will be signed. Without an EVM wallet the route
// has no deposit address to show, so the panel says how to get one.
import { useState } from 'react';
import { parseAddress } from '../../../core/address';
import { ApiFailure } from '../../../core/client/api';
import { InStop, runIn, type InStep } from '../../../core/client/in';
import { thorAsset } from '../../../core/routes/memo';
import { formatUnits, parseUnits } from '../../../core/wallet';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import { useDisclosure } from '../cross/disclosure';
import { EvmWallets } from '../evm/EvmWallets';
import { useEvm } from '../evm/store';
import { useText, type TextKey } from '../i18n';
import { outCodeKey } from '../out/errors';
import { errorKey } from '../swap/errors';
import type { Wallet } from '../wallet/useWallet';
import { useInQuote } from './useInQuote';

const BCH = 'BCH';
const ROUTE_DECIMALS = 8;
const QUOTE_PAUSE_MS = 400;

type Run = { phase: 'idle' } | { phase: 'running'; step: InStep } | { phase: 'done'; crossingId: string; landingId: string | null } | { phase: 'failed'; key: TextKey };

function failKey(e: unknown): TextKey {
  if (e instanceof InStop) return `in.err.${e.reason}` as TextKey;
  if (e instanceof ApiFailure) return outCodeKey(e.code);
  if ((e as { code?: number }).code === 4001) return 'in.err.rejected';
  return errorKey(e);
}

export function InPanel({ config, wallet }: { config: LoadedConfig; wallet: Wallet }) {
  const { t } = useText();
  const evm = useEvm();
  const token = config.tokens[config.defaultToken]!;
  const sources = config.routeChains.flatMap((key) => {
    const chain = config.evm.chains.find((c) => c.key === key);
    return chain ? config.route.symbols.filter((s) => chain.tokens[s]).map((symbol) => ({ chain, symbol, contract: chain.tokens[symbol]! })) : [];
  });
  const [amountText, setAmountText] = useState('');
  const [receive, setReceive] = useState(token.symbol);
  const [addressText, setAddressText] = useState('');
  const [run, setRun] = useState<Run>({ phase: 'idle' });
  const route = t(`route.${config.route.active}` as TextKey);
  const gate = useDisclosure(route);
  const src = sources[0];
  const view = wallet.view;
  const address = view ? (receive === BCH ? view.receive.address : view.receive.tokenAddress) : addressText.trim();
  const addressOk = address !== '' && typeof parseAddress(address, 'bitcoincash') !== 'string';
  const amount = parseUnits(amountText, ROUTE_DECIMALS);
  const quote = useInQuote({ symbol: src?.symbol ?? '', chain: src?.chain.key ?? '', amount, receive, address, addressOk }, QUOTE_PAUSE_MS);
  if (!src) return null;
  const vars = { symbol: src.symbol, chain: src.chain.name, route, token: token.symbol, pct: (config.landing.toleranceBps / 100).toFixed(1) };
  const q = quote.status === 'ok' ? quote.quote : null;
  const busy = run.phase === 'running';
  const limitVars = { min: String(Math.max(config.limits.minUsd, config.limits.routeMinUsd[config.route.active as 'thorchain'] ?? 0)), max: String(config.limits.maxUsd), ...vars };

  const send = (): void => {
    const c = evm.connected;
    if (!c || !q || amount === undefined) return;
    void (async () => {
      try {
        const res = await runIn({
          api,
          provider: c.wallet.provider,
          from: c.address,
          intent: {
            symbol: src.symbol,
            chain: src.chain,
            token: src.contract,
            amount,
            receive,
            address,
            minSats: BigInt(q.minSats),
            ...(receive === BCH ? {} : { landing: { category: token.category, returnAfter: config.landing.returnAfterBlocks, prefix: 'bitcoincash' as const } }),
          },
          timing: { pollMs: config.evm.receiptPollSeconds * 1000, waitMs: config.evm.receiptWaitSeconds * 1000, replanMs: config.evm.replanSeconds * 1000 },
          onStep: (step) => setRun({ phase: 'running', step }),
        });
        setRun({ phase: 'done', crossingId: res.crossingId, landingId: res.landingId });
      } catch (e) {
        setRun({ phase: 'failed', key: failKey(e) });
      }
    })();
  };

  if (run.phase === 'done') {
    return (
      <div className="swap swap--done" aria-live="polite">
        <p className="swap__done">{t(receive === BCH ? 'in.done.bch' : 'in.done.token', vars)}</p>
        <p className="swap__links">
          <a href={`/c/${run.crossingId}`}>{t('swap.status')}</a>
          {run.landingId ? <a href={`/c/${run.landingId}`}>{t('in.landingStatus')}</a> : null}
        </p>
        <button type="button" className="button button--primary" onClick={() => setRun({ phase: 'idle' })}>
          {t('in.again')}
        </button>
      </div>
    );
  }

  const asset = thorAsset(src.chain.key, src.symbol, src.contract);
  const min = q ? formatUnits(BigInt(q.minSats), ROUTE_DECIMALS) : '';
  const label = busy ? t(`in.step.${run.step}`, vars) : t('in.go');
  return (
    <div className="swap in" data-asset={asset}>
      <EvmWallets chain={src.chain.name} />
      <label className="field">
        <span className="field__label">{t('in.amount', vars)}</span>
        <span className="field__row">
          <input className="field__input" inputMode="decimal" autoComplete="off" placeholder="0" value={amountText} disabled={busy} onChange={(e) => setAmountText(e.target.value)} />
          <span className="field__unit">{src.symbol}</span>
        </span>
      </label>
      <div className="swap__sides" role="radiogroup" aria-label={t('in.receive')}>
        {[token.symbol, BCH].map((s) => (
          <button key={s} type="button" role="radio" aria-checked={receive === s} className="swap__side" disabled={busy} onClick={() => setReceive(s)}>
            {t('in.receiveAs', { asset: s })}
          </button>
        ))}
      </div>
      {view ? (
        <p className="land__owner">{t('in.toConnected', { address: `${address.slice(0, 18)}…${address.slice(-6)}` })}</p>
      ) : (
        <label className="field">
          <span className="field__label">{t('in.address')}</span>
          <span className="field__row">
            <input className="field__input field__input--address mono" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="bitcoincash:…" value={addressText} disabled={busy} aria-invalid={addressText.trim() !== '' && !addressOk} onChange={(e) => setAddressText(e.target.value)} />
          </span>
          <span className="field__hint">{t(addressText.trim() !== '' && !addressOk ? 'in.badAddress' : 'in.addressHint')}</span>
        </label>
      )}
      <p className="swap__receive" aria-live="polite">
        {q
          ? t(receive === BCH ? 'in.quote.bch' : 'in.quote.token', { ...vars, about: formatUnits(BigInt(q.expectedSats), ROUTE_DECIMALS), min })
          : quote.status === 'loading'
            ? t('swap.quoting')
            : quote.status === 'error'
              ? t(outCodeKey(quote.code), limitVars)
              : t('in.enter', vars)}
      </p>
      {q && receive !== BCH ? <p className="card__note">{t('in.priceMoves', vars)}</p> : null}
      {q && evm.connected ? <p className="card__note">{t('in.signs', { ...vars, amount: amountText.trim() })}</p> : null}
      {run.phase === 'failed' ? (
        <p className="swap__error" role="alert">
          {t(run.key, limitVars)}
        </p>
      ) : null}
      <button type="button" className="button button--primary" disabled={busy || !q || !evm.connected} onClick={() => gate.run(send)}>
        {label}
      </button>
      {gate.dialog}
    </div>
  );
}
