// The e2e stand-in for WalletConnect (loaded only under SAMPAN_FAKE): it shows a pairing link at once, and the test
// approves it with `window.dispatchEvent(new CustomEvent('sampan:wc-approve', { detail: '0x…' }))`.
import type { WalletConnectProvider } from './walletconnect';

export const FAKE_WC_URI = 'wc:00000000000000000000000000000000000000000000000000000000000000ff@2?relay-protocol=irn&symKey=fake';

export function fakeWalletConnect(): WalletConnectProvider {
  let accounts: string[] = [];
  return {
    pair(onUri) {
      onUri(FAKE_WC_URI);
      return new Promise((resolve) => {
        window.addEventListener(
          'sampan:wc-approve',
          (e) => {
            accounts = [String((e as CustomEvent<string>).detail)];
            resolve(accounts);
          },
          { once: true },
        );
      });
    },
    async request({ method }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return accounts;
      throw new Error(`fake WalletConnect: ${method} is not supported`);
    },
    async disconnect() {
      accounts = [];
    },
  };
}
