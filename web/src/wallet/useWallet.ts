// One BCH wallet connection for the whole page: WizardConnect in production, the fake wallet under
// SAMPAN_FAKE=1. After connecting, the wallet's coins are found with /api/wallet/scan.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWizardConnect, type UseWizardConnectResult } from '@wizardconnect/react';
import { clearSession, DEFAULT_SESSION_KEY } from '@wizardconnect/dapp';
import { scanWallet, type WalletView } from '../../../core/client/scan';
import type { WalletSession } from '../../../core/client/session';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import { wizardSession } from './wizard';

export type WalletStatus = 'idle' | 'connecting' | 'scanning' | 'ready' | 'error';

export interface Wallet {
  status: WalletStatus;
  session: WalletSession | null;
  view: WalletView | null;
  /** WizardConnect pairing link while connecting (null for the fake wallet). */
  uri: string | null;
  qrUri: string | null;
  connect(): void;
  disconnect(): Promise<void>;
  /** Scan again (after a swap). */
  refresh(): void;
  /** True once "Waiting for your wallet" has lasted connect.retryHintSeconds. */
  waitingLong: boolean;
  /** Drop the stored pairing and reload, so the next connect starts with a new link. */
  startAgain(): void;
}

export function useWallet(config: LoadedConfig | null, fakeName: string): Wallet {
  const wiz: UseWizardConnectResult = useWizardConnect({
    dappName: 'Sampan',
    dappIcon: `${location.origin}/favicon.svg`,
    ...(config ? { relayUrls: config.connect.relayUrls } : {}),
  });
  const [fakeSession, setFakeSession] = useState<WalletSession | null>(null);
  const [wizSession, setWizSession] = useState<WalletSession | null>(null);
  const [scanned, setScanned] = useState<{ session: WalletSession; view: WalletView } | null>(null);
  const [failedFor, setFailedFor] = useState<WalletSession | null>(null);
  const scanId = useRef(0);

  // A WizardConnect session is usable once the wallet has shared its xpubs.
  const { manager, state, walletName } = wiz;
  useEffect(() => {
    if (config?.fake || state !== 'connected' || !manager) return;
    const ready = (): void => setWizSession(wizardSession(manager, manager.walletName ?? walletName));
    if (manager.getSessionPaths().length > 0) queueMicrotask(ready);
    else manager.on('walletready', ready);
    return () => {
      manager.off('walletready', ready);
    };
  }, [config?.fake, state, manager, walletName]);
  const session = config?.fake ? fakeSession : state === 'connected' ? wizSession : null;
  const view = scanned && scanned.session === session ? scanned.view : null;

  // Scan whenever the session changes, and again when refresh() bumps the round.
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!session || !config) return;
    const id = ++scanId.current;
    scanWallet(api, session, 'bitcoincash', { gapLimit: config.connect.gapLimit, maxRounds: config.connect.maxScanRounds })
      .then((v) => id === scanId.current && setScanned({ session, view: v }))
      .catch(() => id === scanId.current && setFailedFor(session));
  }, [session, config, round]);
  const refresh = useCallback(() => setRound((r) => r + 1), []);

  const connect = useCallback(() => {
    if (!config) return;
    if (config.fake) {
      void import('../../../core/client/fake-wallet').then((m) => setFakeSession(m.fakeWalletSession(fakeName)));
      return;
    }
    wiz.connect();
  }, [config, wiz, fakeName]);

  const disconnect = useCallback(async () => {
    scanId.current++;
    setScanned(null);
    setFailedFor(null);
    setFakeSession(null);
    setWizSession(null);
    if (!config?.fake) await wiz.disconnect();
  }, [config?.fake, wiz]);

  const status: WalletStatus = session
    ? view
      ? 'ready'
      : failedFor === session
        ? 'error'
        : 'scanning'
    : wiz.state === 'connecting' || wiz.state === 'reconnecting' || (wiz.state === 'connected' && !config?.fake)
      ? 'connecting'
      : 'idle';

  const waitingLong = useLongWait(status === 'connecting', config?.connect.retryHintSeconds ?? null);

  return { status, session, view, uri: wiz.uri, qrUri: wiz.qrUri, connect, disconnect, refresh, waitingLong, startAgain };
}

/** True after `seconds` of `active`; false again as soon as `active` ends. */
function useLongWait(active: boolean, seconds: number | null): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!active || seconds === null) return;
    const id = setTimeout(() => setLong(true), seconds * 1000);
    return () => {
      clearTimeout(id);
      setLong(false);
    };
  }, [active, seconds]);
  return active && long;
}

/**
 * A stored pairing whose wallet never answers keeps the library reconnecting, and its disconnect waits for a
 * relay that may never be ready. Clearing the stored pairing and reloading is the one exit that always works.
 */
function startAgain(): void {
  clearSession(DEFAULT_SESSION_KEY);
  location.reload();
}
