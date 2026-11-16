// Tab "Send out": the stablecoin or BCH to a stablecoin on another chain through the active route. From the
// stablecoin it is two signatures (swap to BCH, then the deposit); the deposit is checked in this browser
// against the numbers shown here, including the memo, before the wallet is asked to sign.
import { useState } from 'react';
import { runOut, StoppedAfterStep1, type OutProgress } from '../../../core/client/out';
import { thorAsset } from '../../../core/routes/memo';
import { formatUnits, parseUnits } from '../../../core/wallet';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import type { Wallet } from '../wallet/useWallet';
import { outCodeKey, outErrorKey } from './errors';
import { useOutQuote } from './useOutQuote';
import { useDisclosure } from '../cross/disclosure';
import { EvmWallets } from '../evm/EvmWallets';
import { shortEvm, useEvm } from '../evm/store';

const BCH = 'BCH';
const BCH_DECIMALS = 8;
const SHOWN_DECIMALS = 2;
const QUOTE_PAUSE_MS = 400;

type Run =
  | { phase: 'idle' }
  | { phase: 'running'; at: OutProgress }
  | { phase: 'done'; crossingId: string }
  | { phase: 'stopped'; swapTxid: string; key: TextKey }
  | { phase: 'failed'; key: TextKey };

/** Route amounts (1e8 units) shown with two decimals, rounded down. */
const shown = (v: string | bigint, decimals: number): string =>
  formatUnits(BigInt(v) / 10n ** BigInt(Math.max(0, decimals - SHOWN_DECIMALS)), Math.min(decimals, SHOWN_DECIMALS), SHOWN_DECIMALS);
const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function OutPanel({ config, wallet, onSwap }: { config: LoadedConfig; wallet: Wallet; onSwap: () => void }) {
  const { t } = useText();
  const token = config.tokens[config.defaultToken]!;
  const targets = config.routeChains.flatMap((key) => {
    const chain = config.evm.chains.find((c) => c.key === key);
    return chain ? config.route.symbols.filter((s) => chain.tokens[s]).map((symbol) => ({ chain, symbol })) : [];
  });
  const [source, setSource] = useState<string>(token.symbol);
  const [text, setText] = useState(config.limits.judgeOutToken[config.route.active as 'thorchain'] ?? '');
  const [target, setTarget] = useState(0);
  const [destination, setDestination] = useState('');
  const [run, setRun] = useState<Run>({ phase: 'idle' });
  const pick = targets[target];
  const decimals = source === BCH ? BCH_DECIMALS : token.decimals;
  const amount = parseUnits(text, decimals);
  const quote = useOutQuote({ source, amount, symbol: pick?.symbol ?? '', chain: pick?.chain.key ?? '', destination: destination.trim() }, QUOTE_PAUSE_MS);
  const view = wallet.view;
  const have = view ? (source === BCH ? view.sats : (view.tokens[token.category.toLowerCase()] ?? 0n)) : undefined;
  const lacking = have !== undefined && amount !== undefined && amount > have;
  const busy = run.phase === 'running';
  const routeName = t(`route.${config.route.active}` as TextKey);
  const evm = useEvm();
  const gate = useDisclosure(routeName);
  if (!pick) return null;
  const vars = { symbol: pick.symbol, chain: pick.chain.name, route: routeName, token: token.symbol };
  const badAddress = destination.trim() !== '' && !/^0x[0-9a-fA-F]{40}$/.test(destination.trim());

  const send = async (fromTxid?: string): Promise<void> => {
    if (!wallet.session || !view || quote.status !== 'ok' || amount === undefined) return;
    const q = quote.quote;
    const pay = `${formatUnits(amount, decimals)} ${source}`;
    try {
      const res = await runOut({
        api,
        session: wallet.session,
        wallet: view,
        ...(fromTxid ? { fromTxid } : {}),
        intent: {
          source,
          amount,
          symbol: pick.symbol,
          chain: pick.chain.key,
          asset: thorAsset(pick.chain.key, pick.symbol, pick.chain.tokens[pick.symbol]),
          destination: destination.trim(),
          minOut: BigInt(q.minOut),
          category: token.category,
          ...(q.swap ? { swapMinReceive: BigInt(q.swap.minReceive) } : {}),
          feeCapSats: BigInt(config.connect.feeCapSats),
          business: config.business,
          prompts: {
            swap: t('out.prompt.swap', { pay, min: q.swap ? formatUnits(BigInt(q.swap.minReceive), BCH_DECIMALS) : '' }),
            deposit: t('out.prompt.deposit', { ...vars, pay, about: shown(q.expectedOut, q.outDecimals), to: short(destination.trim()) }),
          },
        },
        onStep: (at) => setRun({ phase: 'running', at }),
      });
      setRun({ phase: 'done', crossingId: res.crossingId });
      wallet.refresh();
    } catch (e) {
      wallet.refresh();
      if (e instanceof StoppedAfterStep1) setRun({ phase: 'stopped', swapTxid: e.swapTxid, key: outErrorKey(e.reason) });
      else setRun({ phase: 'failed', key: outErrorKey(e) });
    }
  };

  if (run.phase === 'done') {
    return (
      <div className="swap swap--done" aria-live="polite">
        <p className="swap__done">{t('out.done', vars)}</p>
        <p className="swap__links">
          <a href={`/c/${run.crossingId}`}>{t('swap.status')}</a>
        </p>
        <button type="button" className="button button--primary" onClick={() => setRun({ phase: 'idle' })}>
          {t('out.again')}
        </button>
      </div>
    );
  }

  const stepLabel = (at: OutProgress): string => {
    const phase = t(`swap.step.${at.phase}`);
    return source === BCH ? phase : t('out.step', { n: String(at.step), phase });
  };
  const primary = (() => {
    if (!wallet.session) {
      return { label: wallet.status === 'connecting' ? t('wallet.connecting') : t('wallet.connect'), disabled: wallet.status === 'connecting', onClick: wallet.connect };
    }
    if (run.phase === 'running') return { label: stepLabel(run.at), disabled: true, onClick: () => {} };
    if (run.phase === 'stopped') return { label: t('out.continue'), disabled: quote.status !== 'ok', onClick: () => void send(run.swapTxid) };
    if (wallet.status === 'scanning') return { label: t('wallet.scanning'), disabled: true, onClick: () => {} };
    return { label: t('out.go'), disabled: quote.status !== 'ok' || lacking || !view, onClick: () => gate.run(() => void send()) };
  })();
  const q = quote.status === 'ok' ? quote.quote : null;
  const feePct = q ? (q.fees.totalBps / 100).toFixed(1) : '';
  const limitVars = { min: String(Math.max(config.limits.minUsd, config.limits.routeMinUsd[config.route.active as 'thorchain'] ?? 0)), max: String(config.limits.maxUsd), ...vars };

  return (
    <div className="swap out">
      <div className="swap__sides" role="radiogroup" aria-label={t('out.source')}>
        {[token.symbol, BCH].map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={source === s}
            className="swap__side"
            disabled={busy || run.phase === 'stopped'}
            onClick={() => {
              setSource(s);
              setText(s === BCH ? '' : (config.limits.judgeOutToken[config.route.active as 'thorchain'] ?? ''));
              setRun({ phase: 'idle' });
            }}
          >
            {t('out.from', { asset: s })}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="field__label">{t('swap.amount')}</span>
        <span className="field__row">
          <input className="field__input" inputMode="decimal" autoComplete="off" placeholder="0" value={text} disabled={busy || run.phase === 'stopped'} onChange={(e) => setText(e.target.value)} />
          <span className="field__unit">{source}</span>
        </span>
      </label>
      {targets.length > 1 ? (
        <label className="field">
          <span className="field__label">{t('out.to')}</span>
          <select className="out__select" value={target} disabled={busy} onChange={(e) => setTarget(Number(e.target.value))}>
            {targets.map((o, i) => (
              <option key={`${o.chain.key}-${o.symbol}`} value={i}>
                {t('out.toAsset', { symbol: o.symbol, chain: o.chain.name })}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="out__to">{t('out.toOne', vars)}</p>
      )}
      <label className="field">
        <span className="field__label">{t('out.address', vars)}</span>
        <span className="field__row">
          <input
            className="field__input field__input--address mono"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="0x…"
            value={destination}
            disabled={busy || run.phase === 'stopped'}
            aria-invalid={badAddress}
            onChange={(e) => setDestination(e.target.value)}
          />
        </span>
        <span className="field__hint">{t(badAddress ? 'out.badAddress' : 'out.addressHint', vars)}</span>
      </label>
      {evm.connected ? (
        <button type="button" className="link-button out__mine" disabled={busy} onClick={() => setDestination(evm.connected!.address)}>
          {t('out.useMine', { address: shortEvm(evm.connected.address) })}
        </button>
      ) : evm.wallets.length > 0 ? (
        <details className="out__wallets">
          <summary>{t('out.fromWallet')}</summary>
          <EvmWallets chain={pick.chain.name} />
        </details>
      ) : null}
      <p className="swap__receive" aria-live="polite">
        {q
          ? t('out.receive', { ...vars, about: shown(q.expectedOut, q.outDecimals), min: shown(q.minOut, q.outDecimals) })
          : quote.status === 'loading'
            ? t('swap.quoting')
            : quote.status === 'error'
              ? t(outCodeKey(quote.code), limitVars)
              : t('out.enter', vars)}
      </p>
      {q && q.fees.totalBps > config.limits.feeWarnBps ? <p className="swap__error">{t('out.feeHigh', { pct: feePct })}</p> : null}
      {source !== BCH ? <p className="card__note">{t('out.twoSteps', vars)}</p> : null}
      {lacking ? <p className="swap__error">{t('swap.err.short')}</p> : null}
      {run.phase === 'stopped' ? (
        <div className="swap__error" role="alert">
          <p>{t('out.stopped')}</p>
          <p>{t(run.key, limitVars)}</p>
          <button type="button" className="link-button" onClick={onSwap}>
            {t('out.swapBack', vars)}
          </button>
        </div>
      ) : null}
      {run.phase === 'failed' ? (
        <p className="swap__error" role="alert">
          {t(run.key, limitVars)}
        </p>
      ) : null}
      <button type="button" className="button button--primary" disabled={primary.disabled} onClick={primary.onClick}>
        {primary.label}
      </button>
      <details className="swap__fees">
        <summary>{t('swap.fees')}</summary>
        {q ? <p>{t('out.routeFee', { ...vars, fee: shown(q.fees.total, q.outDecimals), pct: feePct })}</p> : null}
        <p>{t('swap.networkFee', { fee: formatUnits(BigInt(config.connect.feeCapSats), BCH_DECIMALS) })}</p>
        <p>{t('out.time', { ...vars, minutes: String(Math.max(1, Math.ceil((q?.seconds ?? 600) / 60))) })}</p>
      </details>
      {gate.dialog}
    </div>
  );
}
