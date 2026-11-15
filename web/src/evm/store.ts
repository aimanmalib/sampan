// EVM wallets in the browser (EIP-6963): every wallet extension announces itself with its own name and icon, and
// the page keeps one connection shared by the tabs. Nothing is remembered between visits.
import { useSyncExternalStore } from 'react';
import type { Eip1193 } from '../../../core/client/in';

export interface EvmWalletInfo {
  uuid: string;
  name: string;
  /** Data URI image supplied by the wallet itself. */
  icon: string;
  rdns: string;
}

export interface EvmProvider extends Eip1193 {
  on?(event: string, listener: (arg: unknown) => void): void;
  removeListener?(event: string, listener: (arg: unknown) => void): void;
}

export interface EvmWallet {
  info: EvmWalletInfo;
  provider: EvmProvider;
}

export interface EvmState {
  wallets: EvmWallet[];
  connected: { wallet: EvmWallet; address: string } | null;
  connecting: boolean;
  failed: boolean;
}

let state: EvmState = { wallets: [], connected: null, connecting: false, failed: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<EvmState>): void => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

let started = false;
function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('eip6963:announceProvider', (e) => {
    const detail = (e as CustomEvent<EvmWallet>).detail;
    if (!detail?.info?.uuid || !detail.provider || state.wallets.some((w) => w.info.uuid === detail.info.uuid)) return;
    // Only image data from the wallet itself is drawn (the page loads no third-party images).
    const icon = /^data:image\//.test(detail.info.icon) ? detail.info.icon : '';
    set({ wallets: [...state.wallets, { info: { ...detail.info, icon }, provider: detail.provider }] });
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

const onAccounts = (arg: unknown): void => {
  const first = Array.isArray(arg) ? (arg[0] as string | undefined) : undefined;
  if (!state.connected) return;
  set({ connected: first ? { ...state.connected, address: first } : null });
};

export async function connectEvm(wallet: EvmWallet): Promise<void> {
  set({ connecting: true, failed: false });
  try {
    const accounts = (await wallet.provider.request({ method: 'eth_requestAccounts' })) as string[];
    if (!accounts[0]) throw new Error('no account');
    state.connected?.wallet.provider.removeListener?.('accountsChanged', onAccounts);
    wallet.provider.on?.('accountsChanged', onAccounts);
    set({ connected: { wallet, address: accounts[0] }, connecting: false });
  } catch {
    set({ connecting: false, failed: true });
  }
}

export function disconnectEvm(): void {
  const c = state.connected;
  if (!c) return;
  c.wallet.provider.removeListener?.('accountsChanged', onAccounts);
  // Wallets that support it forget the permission too; the others keep it until the user removes the site.
  void c.wallet.provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => {});
  set({ connected: null });
}

export function useEvm(): EvmState {
  start();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const shortEvm = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;
