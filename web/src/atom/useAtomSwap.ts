// Page state of one atomic swap (USDC on Base to PUSD): start, recovery card, lock, then a poll every
// config.atom.pollSeconds until the service reports a final state. Swaps started in this browser (here or on the
// service's own page, same storage key) are listed and can be continued.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadedConfig } from '../config';
import type { AtomEip1193, AtomSaved, AtomSwapView } from './client';
import { atomDeps, cardFile, codeOf, lockUsdc, shortAmount, tick, type Activity } from './run';
import type { AtomReady } from './useAtomQuote';

export type AtomPhase = 'idle' | 'starting' | 'card' | 'locking' | 'watching';

export interface AtomSwapState {
  phase: AtomPhase;
  saved: AtomSaved | null;
  swap: AtomSwapView | null;
  /** Whether this swap's recovery card was downloaded in this visit (the lock waits for it). */
  downloaded: boolean;
  step: 'approve' | 'lock' | null;
  activity: Activity;
  /** Stop reason: `offer:<code>` before anything was signed, `maker:<code>` before the secret, else the code. */
  problem: string | null;
}

const IDLE: AtomSwapState = { phase: 'idle', saved: null, swap: null, downloaded: false, step: null, activity: null, problem: null };

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

export function useAtomSwap(config: LoadedConfig, ready: AtomReady) {
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
        if (r.swap.state === 'offered' && saved.card.flow === 'usdc-to-pusd') {
          setState((s) => ({ ...s, phase: 'card', swap: r.swap, downloaded: downloaded.current.has(saved.card.secret.hash) }));
          return;
        }
        setState((s) => ({ ...s, swap: r.swap, activity: r.activity, problem: r.problem ? `maker:${r.problem}` : null }));
        if (r.final || r.problem) return;
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
        .startSwap(deps, { flow: 'usdc-to-pusd', ...input })
        .then((r) => setState({ ...IDLE, phase: 'card', saved: r.saved, swap: r.swap }))
        .catch((e: unknown) => setState({ ...IDLE, problem: `offer:${codeOf(e)}` }));
    },
    [client, deps],
  );

  const download = useCallback(() => {
    if (!state.saved) return;
    const file = cardFile(client, state.saved);
    saveFile(file.name, file.text);
    downloaded.current.add(state.saved.card.secret.hash);
    patch({ downloaded: true });
  }, [client, state.saved]);

  const lock = useCallback(
    (wallet: AtomEip1193) => {
      const saved = state.saved;
      if (!saved) return;
      patch({ phase: 'locking', problem: null, step: null });
      lockUsdc(client, deps, saved, downloaded.current, wallet, (step) => patch({ step }))
        .then(() => patch({ phase: 'watching', step: null }))
        .catch((e: unknown) => patch({ phase: 'card', step: null, problem: codeOf(e) }));
    },
    [client, deps, state.saved],
  );

  const resume = useCallback((saved: AtomSaved) => setState({ ...IDLE, phase: 'watching', saved }), []);
  const reset = useCallback(() => setState(IDLE), []);
  const pending = useMemo(
    () => (state.phase === 'idle' ? deps.store.list() : []),
    // Read again whenever the panel comes back to idle.
    [deps, state.phase],
  );
  const amountIn = (s: AtomSaved) => shortAmount(client.amountInText(shipped, s));
  const amounts = state.saved ? { in: amountIn(state.saved), out: shortAmount(client.amountOutText(shipped, state.saved)) } : null;

  return { state, start, download, lock, resume, reset, pending, amounts, amountIn };
}
