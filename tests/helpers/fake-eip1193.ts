// A fake EIP-1193 provider for tests: one account on one chain, a token with 6 decimals, allowances that change
// when an approve is mined, and a record of every transaction sent. No network.
import { decodeFunctionData, type Hex } from 'viem';
import { ERC20_ABI } from '../../core/evm/calldata.js';
import type { Eip1193 } from '../../core/client/in.js';

export interface FakeEvm extends Eip1193 {
  sent: Array<{ to: string; data: Hex }>;
  chainId: number;
}

const word = (n: bigint): Hex => `0x${n.toString(16).padStart(64, '0')}`;

export function fakeEip1193(o: { chainId?: number; balance?: bigint; allowance?: bigint; startChain?: number; revertDeposit?: boolean } = {}): FakeEvm {
  let allowance = o.allowance ?? 0n;
  const chainId = o.chainId ?? 8453;
  let current = o.startChain ?? chainId;
  const sent: FakeEvm['sent'] = [];
  const fake: FakeEvm = {
    sent,
    chainId,
    async request({ method, params }) {
      const p = (params ?? []) as Array<Record<string, string>>;
      switch (method) {
        case 'eth_chainId':
          return `0x${current.toString(16)}`;
        case 'wallet_switchEthereumChain':
          current = Number(p[0]!.chainId);
          return null;
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return ['0x1a877169bB03400fA69EC4813889E78994D194Cb'];
        case 'eth_call': {
          const data = p[0]!.data as Hex;
          if (data.startsWith('0x313ce567')) return word(6n);
          if (data.startsWith('0x70a08231')) return word(o.balance ?? 10_000_000n);
          if (data.startsWith('0xdd62ed3e')) return word(allowance);
          if (o.revertDeposit) throw new Error('execution reverted');
          return '0x';
        }
        case 'eth_sendTransaction': {
          const tx = p[0]!;
          sent.push({ to: tx.to!, data: tx.data as Hex });
          if (tx.data!.startsWith('0x095ea7b3')) allowance = decodeFunctionData({ abi: ERC20_ABI, data: tx.data as Hex }).args[1] as bigint;
          return `0x${String(sent.length).padStart(64, '0')}`;
        }
        case 'eth_getTransactionReceipt':
          return { status: '0x1' };
        default:
          throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
      }
    },
  };
  return fake;
}
