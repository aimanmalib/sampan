import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';
import { ERC20_ABI, readCall, readResult, ROUTER_ABI, routerDepositCalls, toTokenUnits, transferCall, type RouterDeposit } from './calldata.js';
import { checkInPlan } from './check-in.js';

// Shapes from a frozen THORNode quote (tests/fixtures/thorchain/quote-in.json); no live data.
const ROUTER = '0x00dc6100103BC402d490aEE3F9a5560cBd91f1d4';
const VAULT = '0x4d39d5c55cfeb48f44d680fcac20493635dafdee';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DEST = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const plan: RouterDeposit = { router: ROUTER, vault: VAULT, token: USDC, amount: 500_000_000n, memo: `=:c:${DEST.slice(12)}:2234632`, expiry: 2_000_000_000 };

describe('token units', () => {
  it('turns 1e8 route units into the token decimals exactly', () => {
    expect(toTokenUnits(500_000_000n, 6)).toBe(5_000_000n);
    expect(toTokenUnits(1n, 18)).toBe(10_000_000_000n);
    expect(toTokenUnits(7n, 8)).toBe(7n);
  });
  it('refuses an amount the token cannot carry', () => {
    expect(() => toTokenUnits(123n, 6)).toThrow(/decimals/);
  });
});

describe('router deposit calls', () => {
  it('approves the exact amount when the allowance is short, then deposits', () => {
    const calls = routerDepositCalls(plan, 6, 0n);
    expect(calls.map((c) => c.kind)).toEqual(['approve', 'deposit']);
    const approve = decodeFunctionData({ abi: ERC20_ABI, data: calls[0]!.data });
    expect(calls[0]!.to.toLowerCase()).toBe(USDC.toLowerCase());
    expect(approve.functionName).toBe('approve');
    expect(approve.args).toEqual([ROUTER, 5_000_000n]);
    const dep = decodeFunctionData({ abi: ROUTER_ABI, data: calls[1]!.data });
    expect(calls[1]!.to).toBe(ROUTER);
    expect(dep.args).toEqual([expect.stringMatching(new RegExp(VAULT, 'i')), USDC, 5_000_000n, plan.memo, 2_000_000_000n]);
    expect(calls.every((c) => c.value === '0x0')).toBe(true);
  });
  it('skips the approval when the allowance already covers the amount', () => {
    expect(routerDepositCalls(plan, 6, 5_000_000n).map((c) => c.kind)).toEqual(['deposit']);
  });
  it('clears a nonzero allowance first for tokens that need it', () => {
    const calls = routerDepositCalls(plan, 6, 1n, true);
    expect(calls.map((c) => c.kind)).toEqual(['approve', 'approve', 'deposit']);
    expect(decodeFunctionData({ abi: ERC20_ABI, data: calls[0]!.data }).args).toEqual([ROUTER, 0n]);
  });
  it('refuses a deposit without a memo or with a bad router', () => {
    expect(() => routerDepositCalls({ ...plan, memo: '' }, 6, 0n)).toThrow(/memo/);
    expect(() => routerDepositCalls({ ...plan, router: '0x12' }, 6, 0n)).toThrow(/not an EVM address/);
  });
  it('builds a plain transfer for routes with a deposit address', () => {
    const c = transferCall(USDC, VAULT, 1n);
    expect(decodeFunctionData({ abi: ERC20_ABI, data: c.data }).functionName).toBe('transfer');
  });
  it('reads allowance and decimals results', () => {
    expect(readCall.allowance(VAULT, ROUTER).startsWith('0xdd62ed3e')).toBe(true);
    expect(readResult.uint('allowance', `0x${'0'.repeat(63)}5`)).toBe(5n);
    expect(readResult.decimals(`0x${'0'.repeat(62)}06`)).toBe(6);
  });
});

describe('checkInPlan', () => {
  const want = { token: USDC, amount: 500_000_000n, destination: DEST, minSats: 2_000_000n, now: 1_900_000_000 };
  it('accepts a plan whose memo pays the chosen BCH address at least the minimum', () => {
    expect(checkInPlan(plan, want)).toBe(true);
    expect(checkInPlan({ ...plan, memo: `=:BCH.BCH:${DEST.slice(12)}:2234632` }, want)).toBe(true);
  });
  it('refuses another destination, a low limit, another amount or token, or an old quote', () => {
    expect(checkInPlan({ ...plan, memo: '=:c:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a:2234632' }, want)).toMatch(/another address/);
    expect(checkInPlan({ ...plan, memo: `=:c:${DEST.slice(12)}:10` }, want)).toMatch(/limit/);
    expect(checkInPlan({ ...plan, memo: `=:BASE.USDC:${DEST.slice(12)}:2234632` }, want)).toMatch(/asset/);
    expect(checkInPlan({ ...plan, amount: 1n }, want)).toMatch(/amount/);
    expect(checkInPlan({ ...plan, token: VAULT }, want)).toMatch(/token/);
    expect(checkInPlan({ ...plan, expiry: 1 }, want)).toMatch(/expired/);
  });
});
