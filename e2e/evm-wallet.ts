// A wallet extension stand-in for the Bring in specs (e2e/in.spec.ts, e2e/review.spec.ts): announces itself (EIP-6963)
// and answers the calls the page makes; window.__evmSent lists every transaction it was asked to send.
import type { Page } from '@playwright/test';

export const EVM_ADDRESS = '0x1a877169bB03400fA69EC4813889E78994D194Cb';

/** A wallet extension stand-in: announces itself (EIP-6963) and answers the calls the page makes. */
export async function injectWallet(page: Page): Promise<void> {
  await page.addInitScript((account) => {
    const sent: Array<{ to: string; data: string }> = [];
    let allowance = 0n;
    let chain = '0x1';
    const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`;
    const provider = {
      async request({ method, params }: { method: string; params?: Array<Record<string, string>> }) {
        const p = params ?? [];
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
        if (method === 'eth_chainId') return chain;
        if (method === 'wallet_switchEthereumChain') return void (chain = p[0]!.chainId!);
        if (method === 'wallet_revokePermissions') return null;
        if (method === 'eth_call') {
          const data = p[0]!.data!;
          if (data.startsWith('0x313ce567')) return word(6n);
          if (data.startsWith('0x70a08231')) return word(100_000_000n);
          if (data.startsWith('0xdd62ed3e')) return word(allowance);
          return '0x';
        }
        if (method === 'eth_sendTransaction') {
          const tx = p[0]!;
          sent.push({ to: tx.to!, data: tx.data! });
          if (tx.data!.startsWith('0x095ea7b3')) allowance = BigInt(`0x${tx.data!.slice(74)}`);
          return `0x${String(sent.length).padStart(64, '1')}`;
        }
        if (method === 'eth_getTransactionReceipt') return { status: '0x1' };
        throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
      },
      on() {},
      removeListener() {},
    };
    const icon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#555"/></svg>')}`;
    const announce = () =>
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: 'test-evm', name: 'Test EVM wallet', icon, rdns: 'test.evm' }, provider }) }));
    window.addEventListener('eip6963:requestProvider', announce);
    (window as unknown as { __evmSent: typeof sent }).__evmSent = sent;
  }, EVM_ADDRESS);
}
