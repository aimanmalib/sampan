// Page state of one atomic swap, either way: start, recovery card, lock (USDC on Base from the EVM wallet, or the PUSD
// payment to the contract from the BCH wallet), then a poll every config.atom.pollSeconds until the service reports a
// final state. After the lock's timeout the poll also asks the chain whether the user's lock may be taken back. Swaps
// started in this browser (here or on the service's own page, same storage key) are listed and can be continued.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadedConfig } from '../config';
import type { AtomEip1193, AtomFlow, AtomPaymentRequest, AtomSaved, AtomSwapView } from './client';
import { atomDeps, cardFile, codeOf, lockUsdc, payPusd, refundLock, refundOpenNow, shortAmount, tick, type Activity } from './run';
import type { AtomReady } from './useAtomQuote';

export type AtomPhase = 'idle' | 'starting' | 'card' | 'locking' | 'watching';

export interface AtomSwapState {
  phase: AtomPhase;
  saved: AtomSaved | null;
  swap: AtomSwapView | null;
  /** Whether this swap's recovery card was downloaded in this visit (the lock waits for it). */
  downloaded: boolean;
  step: 'approve' | 'lock' | 'pay' | null;
  activity: Activity;
  /** The chain's clock is past the user's lock timeout and the swap is not final: the refund button shows. */
  refundable: boolean;
  /** Stop reason: `offer:<code>` before anything was signed, `maker:<code>` before the secret, else the code. */
  problem: string | null;
}

const IDLE: AtomSwapState = { phase: 'idle', saved: null, swap: null, downloaded: false, step: null, activity: null, refundable: false, problem: null };

/** How the user's side is locked: USDC by the EVM wallet, or PUSD paid to the contract by the BCH wallet. */
export type LockAction = { kind: 'base'; wallet: AtomEip1193 } | { kind: 'bch'; pay: (request: AtomPaymentRequest) => Promise<string> };

function saveFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function useAtomSwap(config: LoadedConfig, ready: AtomReady, flow: AtomFlow) {
  const { client, shipped } = ready;
  const deps = useMemo(() => atomDeps(client, shipped, config.atom.apiPath, localStorage), [client, shipped, config.atom.apiPath]);
  const [state, setState] = useState<AtomSwapState>(IDLE);
  const downloaded = useRef(new Set<string>());
  const claimed = useRef(new Set<string>());
  const patch = (p: Partial<AtomSwapState>) => setState((s) => ({ ...s, ...p }));

  const hash = state.saved?.card.secret.hash ?? null;
  const watching = state.phase === 'watching';
  useEffect(() => {
    const saved = state.saved;
    if (!watching || !saved) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const r = await tick(client, deps, saved, claimed.current);
        if (!live) return;
        // A swap from the list that was never locked goes back to the card step: the lock waits for the card again.
        if (r.swap.state === 'offered') {
          setState((s) => ({ ...s, phase: 'card', swap: r.swap, downloaded: downloaded.current.has(saved.card.secret.hash) }));
          return;
        }
        const refundable = await refundOpenNow(client, deps, saved, r.swap, Date.now() / 1000);
        if (!live) return;
        setState((s) => ({
          ...s,
          swap: r.swap,
          activity: s.activity === 'refunding' ? s.activity : r.activity,
          refundable,
          problem: r.problem ? `maker:${r.problem}` : s.activity === 'refunding' ? s.problem : null,
        }));
        // A maker problem stops the claim, not the poll: the refund still opens at the lock's timeout.
        if (r.final) return;
      } catch (e) {
        if (!live) return;
        patch({ problem: codeOf(e) });
      }
      timer = setTimeout(() => void poll(), config.atom.pollSeconds * 1000);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Restarted only for another swap or a new watch; state.saved is read through `hash`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, hash, client, deps, config.atom.pollSeconds]);

  const start = useCallback(
    (input: { amount: string; userBch: string; userEvm: string }) => {
      setState({ ...IDLE, phase: 'starting' });
      client
        .startSwap(deps, { flow, ...input })
        .then((r) => setState({ ...IDLE, phase: 'card', saved: r.saved, swap: r.swap }))
        .catch((e: unknown) => setState({ ...IDLE, problem: `offer:${codeOf(e)}` }));
    },
    [client, deps, flow],
  );

  const download = useCallback(() => {
    if (!state.saved) return;
    const file = cardFile(client, state.saved);
    saveFile(file.name, file.text);
    downloaded.current.add(state.saved.card.secret.hash);
    patch({ downloaded: true });
  }, [client, state.saved]);

  const lock = useCallback(
    (action: LockAction) => {
      const saved = state.saved;
      if (!saved) return;
      patch({ phase: 'locking', problem: null, step: action.kind === 'bch' ? 'pay' : null });
      const locked =
        action.kind === 'base'
          ? lockUsdc(client, deps, saved, downloaded.current, action.wallet, (step) => patch({ step }))
          : payPusd(client, deps, saved, downloaded.current, action.pay);
      locked
        .then(() => patch({ phase: 'watching', step: null }))
        .catch((e: unknown) => patch({ phase: 'card', step: null, problem: codeOf(e) }));
    },
    [client, deps, state.saved],
  );

  const refund = useCallback(
    (wallet: AtomEip1193 | null) => {
      const saved = state.saved;
      if (!saved) return;
      patch({ activity: 'refunding', problem: null });
      refundLock(client, deps, saved, wallet)
        .then((swap) => setState((s) => ({ ...s, activity: null, refundable: false, ...(swap ? { swap } : {}) })))
        .catch((e: unknown) => patch({ activity: null, problem: codeOf(e) }));
    },
    [client, deps, state.saved],
  );

  const resume = useCallback((saved: AtomSaved) => setState({ ...IDLE, phase: 'watching', saved }), []);
  const reset = useCallback(() => setState(IDLE), []);
  const pending = useMemo(
    () => (state.phase === 'idle' ? deps.store.list().filter((s) => s.card.flow === flow) : []),
    // Read again whenever the panel comes back to idle.
    [deps, state.phase, flow],
  );
  const amountIn = (s: AtomSaved) => shortAmount(client.amountInText(shipped, s));
  const amounts = state.saved ? { in: amountIn(state.saved), out: shortAmount(client.amountOutText(shipped, state.saved)) } : null;

  return { state, start, download, lock, refund, resume, reset, pending, amounts, amountIn };
}
