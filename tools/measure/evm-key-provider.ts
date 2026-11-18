// An EIP-1193 provider for the EVM test key, so a measuring script runs the page's own Bring in code (core/client/in.ts
// runIn) with no browser wallet: it answers for one chain, signs eth_sendTransaction locally with viem and sends
// everything else to the chain's configured JSON-RPC endpoints, tried in order. The key never leaves this process.
import { createWalletClient, custom, defineChain, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Eip1193 } from '../../core/client/in.js';

export type JsonRpc = (method: string, params: unknown[]) => Promise<unknown>;

/** JSON-RPC over the endpoints in order; the first that answers without a transport error wins. */
export function jsonRpcOver(urls: string[], fetcher: typeof fetch = fetch): JsonRpc {
  let id = 0;
  return async (method, params) => {
    let last: unknown = new Error('no RPC endpoint configured');
    for (const url of urls) {
      let body: { result?: unknown; error?: { code: number; message: string } };
      try {
        const res = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
        body = (await res.json()) as typeof body;
      } catch (e) {
        last = e;
        continue;
      }
      // A JSON-RPC error is the chain's answer (a revert, a bad nonce): another endpoint would give the same one.
      if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code });
      return body.result ?? null;
    }
    throw last;
  };
}

export function keyProvider(o: { key: Hex; chain: { id: number; name: string; native: { name: string; symbol: string } }; rpc: JsonRpc }): Eip1193 & { address: string } {
  const account = privateKeyToAccount(o.key);
  const chain = defineChain({ id: o.chain.id, name: o.chain.name, nativeCurrency: { ...o.chain.native, decimals: 18 }, rpcUrls: { default: { http: [] } } });
  const transport = custom({ request: ({ method, params }: { method: string; params?: unknown }) => o.rpc(method, (params as unknown[] | undefined) ?? []) });
  const wallet = createWalletClient({ account, chain, transport });
  return {
    address: account.address,
    async request({ method, params = [] }) {
      switch (method) {
        case 'eth_chainId':
          return `0x${o.chain.id.toString(16)}`;
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return [account.address];
        case 'wallet_switchEthereumChain': {
          const want = Number((params[0] as { chainId?: string } | undefined)?.chainId);
          if (want === o.chain.id) return null;
          throw Object.assign(new Error('this test provider answers for one chain only'), { code: 4902 });
        }
        case 'wallet_addEthereumChain':
          throw Object.assign(new Error('this test provider answers for one chain only'), { code: 4200 });
        case 'eth_sendTransaction': {
          const t = params[0] as { from?: string; to: Hex; data?: Hex; value?: Hex };
          if (t.from && t.from.toLowerCase() !== account.address.toLowerCase()) throw new Error('the transaction names another sender');
          return wallet.sendTransaction({ to: t.to, ...(t.data ? { data: t.data } : {}), ...(t.value ? { value: BigInt(t.value) } : {}) });
        }
        default:
          return o.rpc(method, params);
      }
    },
  };
}
