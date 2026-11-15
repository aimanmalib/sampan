// Calldata an EVM wallet signs to bring a token in through the active route. Pure: no provider, no network.
// Route B (THORChain): `approve(router, amount)` for the exact amount when the allowance is short, then
// `router.depositWithExpiry(vault, asset, amount, memo, expiry)`. Route A would be one plain `transfer`.
// THORChain quotes count tokens in 1e8 units; the token contract counts in its own decimals.
import { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, type Hex } from 'viem';
import { THOR_DECIMALS } from '../routes/memo.js';

export const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

export const ROUTER_ABI = [
  {
    type: 'function',
    name: 'depositWithExpiry',
    stateMutability: 'payable',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'memo', type: 'string' },
      { name: 'expiration', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

/** One transaction for the wallet: `eth_sendTransaction` params without from/gas (the wallet fills those). */
export interface EvmCall {
  kind: 'approve' | 'deposit' | 'transfer';
  to: Hex;
  data: Hex;
  value: '0x0';
}

/** What the page asks the route for and then signs. Amount in the route's 1e8 units. */
export interface RouterDeposit {
  router: string;
  vault: string;
  /** Token contract on the source chain. */
  token: string;
  amount: bigint;
  memo: string;
  expiry: number;
}

function addr(a: string, what: string): Hex {
  if (!isAddress(a, { strict: false })) throw new Error(`${what} is not an EVM address`);
  return getAddress(a);
}

/** 1e8 route units to the token's own units; refuses amounts the token cannot carry exactly. */
export function toTokenUnits(amount1e8: bigint, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('token decimals out of range');
  if (decimals >= THOR_DECIMALS) return amount1e8 * 10n ** BigInt(decimals - THOR_DECIMALS);
  const step = 10n ** BigInt(THOR_DECIMALS - decimals);
  if (amount1e8 % step !== 0n) throw new Error(`the token has ${decimals} decimals; the amount has more`);
  return amount1e8 / step;
}

export const approveCall = (token: string, spender: string, units: bigint): EvmCall => ({
  kind: 'approve',
  to: addr(token, 'token'),
  data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [addr(spender, 'spender'), units] }),
  value: '0x0',
});

export const transferCall = (token: string, to: string, units: bigint): EvmCall => ({
  kind: 'transfer',
  to: addr(token, 'token'),
  data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [addr(to, 'recipient'), units] }),
  value: '0x0',
});

export function depositCall(d: RouterDeposit, units: bigint): EvmCall {
  if (!d.memo) throw new Error('the deposit has no memo');
  return {
    kind: 'deposit',
    to: addr(d.router, 'router'),
    data: encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: 'depositWithExpiry',
      args: [addr(d.vault, 'vault'), addr(d.token, 'token'), units, d.memo, BigInt(d.expiry)],
    }),
    value: '0x0',
  };
}

/**
 * The calls for a router deposit given the current allowance: approve the exact amount only when the allowance
 * is short (never unlimited), then deposit. `zeroFirst` is for tokens that refuse to change a nonzero allowance.
 */
export function routerDepositCalls(d: RouterDeposit, decimals: number, allowance: bigint, zeroFirst = false): EvmCall[] {
  const units = toTokenUnits(d.amount, decimals);
  if (units <= 0n) throw new Error('nothing to deposit');
  const calls: EvmCall[] = [];
  if (allowance < units) {
    if (zeroFirst && allowance > 0n) calls.push(approveCall(d.token, d.router, 0n));
    calls.push(approveCall(d.token, d.router, units));
  }
  calls.push(depositCall(d, units));
  return calls;
}

/** `eth_call` data for read-only token calls. */
export const readCall = {
  allowance: (owner: string, spender: string): Hex =>
    encodeFunctionData({ abi: ERC20_ABI, functionName: 'allowance', args: [addr(owner, 'owner'), addr(spender, 'spender')] }),
  balanceOf: (owner: string): Hex => encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [addr(owner, 'owner')] }),
  decimals: (): Hex => encodeFunctionData({ abi: ERC20_ABI, functionName: 'decimals' }),
};

export const readResult = {
  uint: (fn: 'allowance' | 'balanceOf', data: Hex): bigint => decodeFunctionResult({ abi: ERC20_ABI, functionName: fn, data }),
  decimals: (data: Hex): number => Number(decodeFunctionResult({ abi: ERC20_ABI, functionName: 'decimals', data })),
};
