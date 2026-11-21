// Tells when a connected wallet has gone: the connection manager reports `disconnect`, or a wallet that was ready
// has been `reconnecting` for connect.lostAfterSeconds (the relay dropped, or the wallet quietly ended the session).
// Without this the page would keep showing "Waiting for your wallet" for ever.

export type LinkEvent = 'walletready' | 'reconnecting' | 'disconnect';

/** The part of the WizardConnect connection manager (or the fake wallet's stand-in) this module listens to. */
export interface LinkSource {
  on(event: LinkEvent, listener: () => void): unknown;
  off(event: LinkEvent, listener: () => void): unknown;
}

export interface LostOptions {
  lostAfterMs: number;
  /** True when the wallet had already shared its keys before listening started. */
  readyNow: boolean;
  onLost(): void;
}

/** Listens to `source` until the returned function is called; calls `onLost` at most once. */
export function watchLost(source: LinkSource, options: LostOptions): () => void {
  let ready = options.readyNow;
  let lost = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stopTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const lose = (): void => {
    if (lost) return;
    lost = true;
    stopTimer();
    options.onLost();
  };
  const onReady = (): void => {
    ready = true;
    stopTimer();
  };
  // A restore that never reached the wallet stays with the retry hint; only a wallet that was ready can be lost.
  const onReconnecting = (): void => {
    if (ready && !lost && timer === null) timer = setTimeout(lose, options.lostAfterMs);
  };
  source.on('walletready', onReady);
  source.on('reconnecting', onReconnecting);
  source.on('disconnect', lose);
  return () => {
    stopTimer();
    source.off('walletready', onReady);
    source.off('reconnecting', onReconnecting);
    source.off('disconnect', lose);
  };
}

/** The fake wallet's stand-in: e2e tests fire `sampan:wallet-link` with detail walletready, reconnecting or disconnect. */
export function fakeLinkSource(): LinkSource {
  const listeners = new Map<() => void, (e: Event) => void>();
  return {
    on(event, listener) {
      const wrapped = (e: Event): void => {
        if ((e as CustomEvent<string>).detail === event) listener();
      };
      listeners.set(listener, wrapped);
      window.addEventListener('sampan:wallet-link', wrapped);
    },
    off(_event, listener) {
      const wrapped = listeners.get(listener);
      if (wrapped) window.removeEventListener('sampan:wallet-link', wrapped);
      listeners.delete(listener);
    },
  };
}
