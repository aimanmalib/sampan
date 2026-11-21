// Tab "Swap on BCH": BCH <-> an offered token (the default, or MUSD behind its flag) through Cauldron pools, one signature. The transaction is
// checked in this browser against the numbers shown here before the wallet is asked to sign.
import { useState } from 'react';
import { runSwap, type SwapStep } from '../../../core/client/swap';
import { POOL_V0_FEE_DENOMINATOR, POOL_V0_FEE_NUMERATOR } from '../../../core/pools/template';
import type { TradeSide } from '../../../core/pools/trade';
import { formatUnits, parseUnits } from '../../../core/wallet';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import { RouteFactLine } from '../facts/RouteFactLine';
import { useText } from '../i18n';
import type { Wallet } from '../wallet/useWallet';
import { WizardHat } from '../wallet/WizardHat';
import { UnitChip } from '../chips/Chip';
import { codeKey, errorKey } from './errors';
import { useQuote } from './useQuote';
import { PegNote } from '../peg/PegNote';
import { TokenPick } from './TokenPick';
import { QuoteAge } from '../quote/QuoteAge';
import { useRefreshTick } from '../quote/refresh';
import { useReview } from '../review/Review';
import { swapRows } from '../review/rows';
import { connectLabel } from '../wallet/LostNotice';

const BCH_DECIMALS = 8;
const QUOTE_PAUSE_MS = 400;

type Run =
  | { phase: 'idle' }
  | { phase: 'running'; step: SwapStep }
  | { phase: 'done'; txid: string; crossingId: string }
  | { phase: 'failed'; key: ReturnType<typeof errorKey> };

const pct = (num: bigint, den: bigint): string => (Number((num * 10000n) / den) / 100).toString();

export function SwapPanel({ config, wallet }: { config: LoadedConfig; wallet: Wallet }) {
  const { t } = useText();
  const [symbol, setSymbol] = useState(config.defaultToken);
  // The stablecoin choice shows once a wallet is connected, so the card on the first screen keeps its height (ADR 0096);
  // without a wallet the swap is on the default token.
  const picking = Boolean(wallet.session);
  const token = (picking ? config.tokens[symbol] : undefined) ?? config.tokens[config.defaultToken]!;
  const [side, setSide] = useState<TradeSide>('buy');
  const [text, setText] = useState(config.limits.judgeSwapBch);
  const [run, setRun] = useState<Run>({ phase: 'idle' });
  const payDecimals = side === 'buy' ? BCH_DECIMALS : token.decimals;
  const getDecimals = side === 'buy' ? token.decimals : BCH_DECIMALS;
  const payUnit = side === 'buy' ? 'BCH' : token.symbol;
  const getUnit = side === 'buy' ? token.symbol : 'BCH';
  const amount = parseUnits(text, payDecimals);
  // The price asks again by itself while nothing is being signed (config quote.autoRefreshMs).
  const tick = useRefreshTick(config.quote.autoRefreshMs, run.phase !== 'running');
  const quote = useQuote(token.symbol, side, amount, QUOTE_PAUSE_MS, tick);
  const view = wallet.view;
  const have = view ? (side === 'buy' ? view.sats : (view.tokens[token.category.toLowerCase()] ?? 0n)) : undefined;
  const short = have !== undefined && amount !== undefined && amount > have;
  const busy = run.phase === 'running';
  // The token is a dollar stablecoin: its own amount when selling it, the quote's token amount when buying it.
  const usdUnits = side === 'sell' ? amount : quote.status === 'ok' ? BigInt(quote.quote.demand) : undefined;
  const usd = usdUnits === undefined ? undefined : Number(formatUnits(usdUnits, token.decimals));

  const pick = (next: TradeSide): void => {
    if (next === side || busy) return;
    setSide(next);
    setText(next === 'buy' ? config.limits.judgeSwapBch : '');
    setRun({ phase: 'idle' });
  };

  const pickToken = (next: string): void => {
    if (next === token.symbol || busy) return;
    setSymbol(next);
    if (side === 'sell') setText('');
    setRun({ phase: 'idle' });
  };

  const swap = async (): Promise<void> => {
    if (!wallet.session || !view || quote.status !== 'ok' || amount === undefined) return;
    const minReceive = BigInt(quote.quote.minReceive);
    const prompt = t('swap.prompt', {
      pay: `${formatUnits(amount, payDecimals)} ${payUnit}`,
      min: `${formatUnits(minReceive, getDecimals)} ${getUnit}`,
    });
    try {
      const res = await runSwap({
        api,
        session: wallet.session,
        wallet: view,
        intent: { token: token.symbol, side, amount, minReceive, category: token.category, feeCapSats: BigInt(config.connect.feeCapSats), userPrompt: prompt, business: config.business },
        onStep: (step) => setRun({ phase: 'running', step }),
      });
      setRun({ phase: 'done', txid: res.txid, crossingId: res.crossingId });
      wallet.refresh();
    } catch (e) {
      setRun({ phase: 'failed', key: errorKey(e) });
    }
  };

  // The review before signing lists the numbers the wallet is asked to sign (features.reviewModal).
  const review = useReview({
    on: config.features.reviewModal,
    disclose: null,
    rows:
      quote.status === 'ok' && amount !== undefined
        ? swapRows(t, {
            pay: `${formatUnits(amount, payDecimals)} ${payUnit}`,
            about: formatUnits(BigInt(quote.quote.demand), getDecimals),
            min: formatUnits(BigInt(quote.quote.minReceive), getDecimals),
            asset: getUnit,
            poolPct: pct(POOL_V0_FEE_NUMERATOR, POOL_V0_FEE_DENOMINATOR),
            feeCap: formatUnits(BigInt(config.connect.feeCapSats), BCH_DECIMALS),
          })
        : null,
    onConfirm: () => void swap(),
  });

  if (run.phase === 'done') {
    return (
      <div className="swap swap--done" aria-live="polite">
        <p className="swap__done">{t('swap.done')}</p>
        <p className="swap__tx">
          <span className="mono">{`${run.txid.slice(0, 10)}…${run.txid.slice(-8)}`}</span>
        </p>
        <p className="swap__links">
          <a href={config.connect.explorerTxUrl.replace('{txid}', run.txid)} target="_blank" rel="noreferrer">
            {t('swap.viewTx')}
          </a>
          <a href={`/c/${run.crossingId}`}>{t('swap.status')}</a>
        </p>
        <button type="button" className="button button--primary" onClick={() => setRun({ phase: 'idle' })}>
          {t('swap.again')}
        </button>
      </div>
    );
  }

  const primary = (() => {
    if (!wallet.session) {
      return { label: connectLabel(wallet.status, t), disabled: wallet.status === 'connecting', onClick: wallet.connect, hat: true };
    }
    if (run.phase === 'running') return { label: t(`swap.step.${run.step}`), disabled: true, onClick: () => {} };
    if (wallet.status === 'scanning') return { label: t('wallet.scanning'), disabled: true, onClick: () => {} };
    return { label: t('swap.go'), disabled: quote.status !== 'ok' || short || !view, onClick: review.open };
  })();

  return (
    <div className="swap">
      <div className="swap__sides" role="radiogroup" aria-label={t('swap.direction')}>
        {(['buy', 'sell'] as const).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={side === s} className="swap__side" onClick={() => pick(s)}>
            {t(s === 'buy' ? 'swap.buy' : 'swap.sell', { symbol: token.symbol })}
          </button>
        ))}
      </div>
      {picking ? <TokenPick config={config} value={token.symbol} disabled={busy} onPick={pickToken} /> : null}
      <label className="field">
        <span className="field__label">{t('swap.amount')}</span>
        <span className="field__row">
          <input
            className="field__input"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={text}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              setRun({ phase: 'idle' });
            }}
          />
          <UnitChip config={config} name={payUnit} usd={usd} />
        </span>
      </label>
      <p className="swap__receive" aria-live="polite">
        {quote.status === 'ok'
          ? t('swap.receive', {
              about: formatUnits(BigInt(quote.quote.demand), getDecimals),
              min: formatUnits(BigInt(quote.quote.minReceive), getDecimals),
              asset: getUnit,
            })
          : quote.status === 'loading'
            ? t('swap.quoting')
            : quote.status === 'error'
              ? t(codeKey(quote.code), { min: formatUnits(BigInt(config.limits.localMinSats), BCH_DECIMALS), max: String(config.limits.maxUsd) })
              : t('swap.enterAmount')}
      </p>
      {wallet.session ? (
        <p className="swap__wallet">
          <span>
            {view
              ? t('wallet.balance', {
                  bch: formatUnits(view.sats, BCH_DECIMALS),
                  token: formatUnits(view.tokens[token.category.toLowerCase()] ?? 0n, token.decimals, token.decimals),
                  symbol: token.symbol,
                })
              : wallet.status === 'error'
                ? t('wallet.scanFailed')
                : t('wallet.scanning')}
          </span>
          <button type="button" className="link-button" onClick={() => void wallet.disconnect()} disabled={busy}>
            {t('wallet.disconnect')}
          </button>
        </p>
      ) : null}
      {short ? <p className="swap__error">{t('swap.err.short')}</p> : null}
      <PegNote />
      {run.phase === 'failed' ? (
        <p className="swap__error" role="alert">
          {t(run.key, { min: formatUnits(BigInt(config.limits.localMinSats), BCH_DECIMALS), max: String(config.limits.maxUsd) })}
        </p>
      ) : null}
      <button type="button" className="button button--primary" disabled={primary.disabled} onClick={primary.onClick}>
        {primary.hat ? <WizardHat /> : null}
        {primary.label}
      </button>
      {/* The price's age shares the Fees line, so the card is no taller (first screen, ADR 0078). */}
      <div className="swap__foot">
        <details className="swap__fees">
          <summary>{t('swap.fees')}</summary>
          <p>{t('swap.poolFee', { pct: pct(POOL_V0_FEE_NUMERATOR, POOL_V0_FEE_DENOMINATOR) })}</p>
          <p>{t('swap.networkFee', { fee: formatUnits(BigInt(config.connect.feeCapSats), BCH_DECIMALS) })}</p>
          <p>
            {config.business.feeBps > 0 ? t('swap.sampanFee', { pct: pct(BigInt(config.business.feeBps), 10000n) }) : t('swap.sampanFeeNone')}
            {quote.status === 'ok' && BigInt(quote.quote.sampanFeeSats) > 0n
              ? ` ${t('swap.sampanFeeQuote', { fee: formatUnits(BigInt(quote.quote.sampanFeeSats), BCH_DECIMALS) })}`
              : null}
          </p>
        </details>
        <RouteFactLine id="swap" short />
        <QuoteAge at={quote.status === 'ok' && config.quote.autoRefreshMs > 0 ? quote.at : null} />
      </div>
      {review.dialog}
    </div>
  );
}
