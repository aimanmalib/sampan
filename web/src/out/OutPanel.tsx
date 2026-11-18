// Tab "Send out": the stablecoin or BCH to a stablecoin on another chain through the active route. From the
// stablecoin it is two signatures (swap to BCH, then the deposit); the deposit is checked in this browser
// against the numbers shown here, including the memo, before the wallet is asked to sign.
import { useState } from 'react';
import { runOut, StoppedAfterStep1, type OutProgress } from '../../../core/client/out';
import { offersOneClick } from '../../../core/oneclick-config';
import { thorFromOut } from '../../../core/routes/compare';
import { formatUnits, parseUnits } from '../../../core/wallet';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';
import type { Wallet } from '../wallet/useWallet';
import { WizardHat } from '../wallet/WizardHat';
import { outCodeKey, outErrorKey } from './errors';
import { useOutQuote } from './useOutQuote';
import { useDisclosure } from '../cross/disclosure';
import { EvmWallets } from '../evm/EvmWallets';
import { shortEvm, useEvm } from '../evm/store';
import { AtomSwap } from '../atom/AtomSwap';
import { bchPayer } from '../atom/payBch';
import { shortAmount } from '../atom/run';
import { CHAIN_HALTED, useRouteChoice } from '../atom/RouteChoice';
import { NetworkPicker } from '../cross/NetworkPicker';
import { useNetworks } from '../cross/useNetworks';
import { CostCard } from '../cost/CostCard';
import { outCard } from '../cost/inputs';
import { UnitChip } from '../chips/Chip';
import { PegNote } from '../peg/PegNote';

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
/** The expected amount, rounded to the nearest like the cost card's "receive about" (the minimum stays rounded down). */
const about = (v: string | bigint, decimals: number): string => {
  const step = 10n ** BigInt(Math.max(0, decimals - SHOWN_DECIMALS));
  return formatUnits((BigInt(v) + step / 2n) / step, Math.min(decimals, SHOWN_DECIMALS), SHOWN_DECIMALS);
};
const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function OutPanel({ config, wallet, onSwap }: { config: LoadedConfig; wallet: Wallet; onSwap: () => void }) {
  const { t } = useText();
  const token = config.tokens[config.defaultToken]!;
  const networks = useNetworks(config, 'out');
  const [source, setSource] = useState<string>(token.symbol);
  const [text, setText] = useState(config.limits.judgeOutToken[config.route.active as 'thorchain'] ?? '');
  const [destination, setDestination] = useState('');
  const [run, setRun] = useState<Run>({ phase: 'idle' });
  const pick = networks.pick;
  const decimals = source === BCH ? BCH_DECIMALS : token.decimals;
  const amount = parseUnits(text, decimals);
  const ask = { source, amount, symbol: pick?.symbol ?? '', chain: pick?.chain.key ?? '', destination: destination.trim() };
  // THORChain is asked only for a network it offers now; a network only 1Click offers gets no THORChain request.
  const thorOffered = pick?.thor === true;
  const thorQuote = useOutQuote({ ...ask, enabled: thorOffered }, QUOTE_PAUSE_MS);
  // 1Click is asked (by the server, dry) only while the flag is on and config offers this asset out.
  const ocOffered = pick !== undefined && offersOneClick(config.features.oneClick, config.oneClick, 'out', pick.chain.key, pick.symbol);
  const ocQuote = useOutQuote({ ...ask, route: 'near-intents', enabled: ocOffered }, config.oneClick.dryDebounceMs);
  const view = wallet.view;
  const have = view ? (source === BCH ? view.sats : (view.tokens[token.category.toLowerCase()] ?? 0n)) : undefined;
  const lacking = have !== undefined && amount !== undefined && amount > have;
  const busy = run.phase === 'running';
  const evm = useEvm();
  const side = (s: typeof thorQuote) => (s.status === 'ok' ? thorFromOut(s.quote, pick?.symbol) : { error: s.status === 'error' ? s.code : 'pending' });
  const minFor = (route: string): string => String(Math.max(config.limits.minUsd, config.limits.routeMinUsd[route as 'thorchain'] ?? 0));
  const ocVars = { route: t('route.near-intents'), symbol: pick?.symbol ?? '', chain: pick?.chain.name ?? '', token: token.symbol, min: minFor('near-intents'), max: String(config.limits.maxUsd) };
  const choice = useRouteChoice(
    config,
    pick && amount !== undefined && amount > 0n ? { kind: 'out', amount: formatUnits(amount, decimals), source, chain: pick.chain.key, symbol: pick.symbol } : null,
    thorOffered ? side(thorQuote) : { error: CHAIN_HALTED },
    ocOffered ? { quote: side(ocQuote), vars: ocVars } : null,
  );
  const atom = choice.route === 'atom';
  const oneClick = choice.route === 'near-intents';
  // The quote the panel shows, costs and signs: the chosen route's.
  const quote = oneClick ? ocQuote : thorQuote;
  const chosenRoute = oneClick ? 'near-intents' : config.route.active;
  const routeName = t(`route.${chosenRoute}` as TextKey);
  const gate = useDisclosure(routeName);
  const q = quote.status === 'ok' ? quote.quote : null;
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
          asset: pick.asset,
          destination: destination.trim(),
          minOut: BigInt(q.minOut),
          category: token.category,
          ...(q.swap ? { swapMinReceive: BigInt(q.swap.minReceive) } : {}),
          feeCapSats: BigInt(config.connect.feeCapSats),
          business: config.business,
          ...(oneClick ? { route: 'near-intents' as const } : {}),
          prompts: {
            swap: t('out.prompt.swap', { pay, min: q.swap ? formatUnits(BigInt(q.swap.minReceive), BCH_DECIMALS) : '' }),
            deposit: t('out.prompt.deposit', { ...vars, pay, about: about(q.expectedOut, q.outDecimals), to: short(destination.trim()) }),
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
      return { label: wallet.status === 'connecting' ? t('wallet.connecting') : t('wallet.connect'), disabled: wallet.status === 'connecting', onClick: wallet.connect, hat: true };
    }
    if (run.phase === 'running') return { label: stepLabel(run.at), disabled: true, onClick: () => {} };
    if (run.phase === 'stopped') return { label: t('out.continue'), disabled: quote.status !== 'ok', onClick: () => void send(run.swapTxid) };
    if (wallet.status === 'scanning') return { label: t('wallet.scanning'), disabled: true, onClick: () => {} };
    return { label: t('out.go'), disabled: quote.status !== 'ok' || lacking || !view, onClick: () => gate.run(() => void send()) };
  })();
  const feePct = q ? (q.fees.totalBps / 100).toFixed(1) : '';
  const cost = q && amount !== undefined ? outCard(config, q, source, amount, pick.chain.key, chosenRoute) : null;
  // The cost card replaces the older fee line and fee details, so the screen gives one statement of the cost.
  const costShown = cost !== null && !atom;
  const limitVars = { min: minFor(chosenRoute), max: String(config.limits.maxUsd), ...vars };

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
          <UnitChip config={config} name={source} usd={source === token.symbol && amount !== undefined ? Number(formatUnits(amount, token.decimals)) : undefined} />
        </span>
      </label>
      {networks.choices.length > 1 ? (
        <NetworkPicker config={config} choices={networks.choices} value={pick.asset} disabled={busy} onChange={networks.choose} />
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
      ) : evm.wallets.length > 0 || config.evm.walletConnect ? (
        <details className="out__wallets">
          <summary>{t('out.fromWallet')}</summary>
          <EvmWallets chain={pick.chain.name} config={config} />
        </details>
      ) : null}
      <p className="swap__receive" aria-live="polite">
        {q
          ? t('out.receive', { ...vars, about: about(q.expectedOut, q.outDecimals), min: shown(q.minOut, q.outDecimals) })
          : quote.status === 'loading'
            ? t('swap.quoting')
            : quote.status === 'error'
              ? t(outCodeKey(quote.code), limitVars)
              : t('out.enter', vars)}
      </p>
      {q && !costShown && q.fees.totalBps > config.limits.feeWarnBps ? <p className="swap__error">{t('out.feeHigh', { pct: feePct })}</p> : null}
      {source !== BCH && !atom ? <p className="card__note">{t('out.twoSteps', vars)}</p> : null}
      {lacking ? <p className="swap__error">{t('swap.err.short')}</p> : null}
      <PegNote />
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
      {choice.card}
      {costShown && cost ? <CostCard card={cost} vars={vars} warnBps={config.limits.feeWarnBps} /> : null}
      {atom && choice.atom ? (
        <AtomSwap
          config={config}
          ready={choice.atom}
          flow="pusd-to-usdc"
          amount={amount !== undefined && amount > 0n && !lacking ? formatUnits(amount, decimals) : null}
          userBch={view ? view.receive.tokenAddress : null}
          userEvm={destination.trim() !== '' && !badAddress ? destination.trim() : null}
          evm={null}
          payBch={bchPayer(config, wallet, (r) => t('atom.prompt.pay', { amount: shortAmount(r.tokenAmount), token: token.symbol }))}
        />
      ) : (
        <button type="button" className="button button--primary" disabled={primary.disabled} onClick={primary.onClick}>
          {primary.hat ? <WizardHat /> : null}
          {primary.label}
        </button>
      )}
      <details className="swap__fees" hidden={atom || costShown}>
        <summary>{t('swap.fees')}</summary>
        {q ? <p>{t('out.routeFee', { ...vars, fee: shown(q.fees.total, q.outDecimals), pct: feePct })}</p> : null}
        <p>{t('swap.networkFee', { fee: formatUnits(BigInt(config.connect.feeCapSats), BCH_DECIMALS) })}</p>
        <p>{t('out.time', { ...vars, minutes: String(Math.max(1, Math.ceil((q?.seconds ?? 600) / 60))) })}</p>
      </details>
      {gate.dialog}
    </div>
  );
}
