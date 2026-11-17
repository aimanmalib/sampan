// Flow C as the page runs it with an EVM wallet (route B): switch the wallet to the source chain, ask the server
// for a plan, check it here (memo destination and limit; a landing address is recomputed from its card), read the
// token's decimals and allowance, approve the exact amount when needed, ask again for a fresh plan when the first
// one is old, simulate each call with eth_call, send it, and record the deposit's hash. No keys in the page.
import type { Hex } from 'viem';
import type { CashPrefix } from '../address.js';
import type { EvmChain } from '../route-assets.js';
import { readCall, readResult, routerDepositCalls, toTokenUnits, type EvmCall, type RouterDeposit } from '../evm/calldata.js';
import { checkInPlan } from '../evm/check-in.js';
import type { Api } from './api.js';
import { acceptCard } from './land.js';

/** The part of an EIP-1193 provider this flow uses. */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export class InStop extends Error {
  constructor(
    readonly reason: 'plan_mismatch' | 'not_enough_tokens' | 'simulation_failed' | 'approval_timeout' | 'approval_failed' | 'route_changed' | 'wrong_chain',
    message: string,
  ) {
    super(message);
    this.name = 'InStop';
  }
}

export interface InIntent {
  symbol: string;
  chain: Pick<EvmChain, 'id' | 'key' | 'name' | 'rpc' | 'explorer' | 'native'>;
  /** Token contract on the source chain and its decimals from config (the chain must report the same). */
  token: string;
  decimals: number;
  /** 1e8 route units. */
  amount: bigint;
  /** 'BCH' or the stablecoin symbol. */
  receive: string;
  /** The user's BCH address. */
  address: string;
  minSats: bigint;
  /** For a landing address: what the card must agree with. */
  landing?: { category: string; returnAfter: number; prefix: CashPrefix };
}

export type InStep = 'chain' | 'plan' | 'approve' | 'confirm' | 'deposit' | 'record';

export interface InTiming {
  pollMs: number;
  waitMs: number;
  replanMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface PlanReply {
  crossingId: string;
  deposit: { router: string; vault: string; token: string; amount: string; memo: string; expiry: number };
  landing?: { crossingId: string; card: unknown };
}

export interface InResult {
  crossingId: string;
  landingId: string | null;
  hash: Hex;
}

const hex = (n: number): string => `0x${n.toString(16)}`;

export async function ensureChain(p: Eip1193, chain: InIntent['chain']): Promise<void> {
  if (Number(await p.request({ method: 'eth_chainId' })) === chain.id) return;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex(chain.id) }] });
  } catch (e) {
    // 4902: the wallet does not know the chain yet; offer it with the RPC and explorer from config.
    if ((e as { code?: number }).code !== 4902) throw e;
    await p.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: hex(chain.id), chainName: chain.name, rpcUrls: chain.rpc, blockExplorerUrls: [chain.explorer], nativeCurrency: { ...chain.native, decimals: 18 } }],
    });
  }
  if (Number(await p.request({ method: 'eth_chainId' })) !== chain.id) throw new InStop('wrong_chain', `switch the wallet to ${chain.name}`);
}

const ethCall = async (p: Eip1193, from: string, to: string, data: Hex): Promise<Hex> =>
  (await p.request({ method: 'eth_call', params: [{ from, to, data }, 'latest'] })) as Hex;

async function send(p: Eip1193, from: string, call: EvmCall): Promise<Hex> {
  try {
    await ethCall(p, from, call.to, call.data);
  } catch (e) {
    throw new InStop('simulation_failed', `${call.kind} would fail: ${(e as Error).message}`);
  }
  return (await p.request({ method: 'eth_sendTransaction', params: [{ from, to: call.to, data: call.data, value: call.value }] })) as Hex;
}

async function confirmed(p: Eip1193, hash: Hex, t: InTiming): Promise<void> {
  const now = t.now ?? Date.now;
  const sleep = t.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const until = now() + t.waitMs;
  while (now() < until) {
    const r = (await p.request({ method: 'eth_getTransactionReceipt', params: [hash] })) as { status?: string } | null;
    if (r?.status === '0x1') return;
    if (r?.status === '0x0') throw new InStop('approval_failed', 'the approval was reverted');
    await sleep(t.pollMs);
  }
  throw new InStop('approval_timeout', 'the approval did not confirm in time');
}

async function plan(api: Api, i: InIntent, now: number): Promise<{ reply: PlanReply; deposit: RouterDeposit; destination: string }> {
  const reply = await api.post<PlanReply>('/api/in/plan', {
    symbol: i.symbol,
    chain: i.chain.key,
    amount: i.amount.toString(),
    receive: i.receive,
    address: i.address,
    minSats: i.minSats.toString(),
  });
  let destination = i.address;
  if (reply.landing) {
    if (!i.landing) throw new InStop('plan_mismatch', 'a landing address was not asked for');
    try {
      destination = acceptCard(reply.landing.card, { ownerAddress: i.address, token: i.receive, ...i.landing }).card.address;
    } catch (e) {
      throw new InStop('plan_mismatch', (e as Error).message);
    }
  } else if (i.landing) throw new InStop('plan_mismatch', 'the plan has no landing address');
  const deposit: RouterDeposit = { ...reply.deposit, amount: BigInt(reply.deposit.amount) };
  const ok = checkInPlan(deposit, { token: i.token, amount: i.amount, destination, minSats: i.minSats, now: Math.floor(now / 1000) });
  if (ok !== true) throw new InStop('plan_mismatch', ok);
  return { reply, deposit, destination };
}

export async function runIn(o: { api: Api; provider: Eip1193; from: string; intent: InIntent; timing: InTiming; onStep: (s: InStep) => void }): Promise<InResult> {
  const { api, provider: p, from, intent: i, timing: t } = o;
  const now = t.now ?? Date.now;
  o.onStep('chain');
  await ensureChain(p, i.chain);
  o.onStep('plan');
  let planned = { ...(await plan(api, i, now())), at: now() };
  const decimals = readResult.decimals(await ethCall(p, from, i.token, readCall.decimals()));
  // Amounts are scaled by the config's decimals (18 on BNB Smart Chain); a token that says otherwise is not the one listed.
  if (decimals !== i.decimals) throw new InStop('plan_mismatch', `the token reports ${decimals} decimals, config lists ${i.decimals}`);
  const balance = readResult.uint('balanceOf', await ethCall(p, from, i.token, readCall.balanceOf(from)));
  const allowance = async (router: string) => readResult.uint('allowance', await ethCall(p, from, i.token, readCall.allowance(from, router)));
  let calls = routerDepositCalls(planned.deposit, decimals, await allowance(planned.deposit.router));
  if (balance < toTokenUnits(planned.deposit.amount, decimals))
    throw new InStop('not_enough_tokens', 'the wallet holds less than the amount');
  if (calls.length > 1) {
    for (const approve of calls.slice(0, -1)) {
      o.onStep('approve');
      const hash = await send(p, from, approve);
      o.onStep('confirm');
      await confirmed(p, hash, t);
    }
    if (now() - planned.at > t.replanMs) {
      o.onStep('plan');
      planned = { ...(await plan(api, i, now())), at: now() };
    }
    calls = routerDepositCalls(planned.deposit, decimals, await allowance(planned.deposit.router));
    if (calls.length > 1) throw new InStop('route_changed', 'the route changed its router; start again');
  }
  o.onStep('deposit');
  const hash = await send(p, from, calls[0]!);
  o.onStep('record');
  await api.post(`/api/in/${planned.reply.crossingId}/sent`, { txHash: hash });
  return { crossingId: planned.reply.crossingId, landingId: planned.reply.landing?.crossingId ?? null, hash };
}

export interface WireInQuote {
  route: string;
  asset: string;
  amount: string;
  destination: string;
  expectedSats: string;
  minSats: string;
  expiry: number;
  seconds: number;
  usd: number;
}

export async function quoteIn(api: Api, ask: { symbol: string; chain: string; amount: bigint; receive: string; address: string }): Promise<WireInQuote> {
  const reply = await api.post<{ quote: WireInQuote }>('/api/in/quote', { ...ask, amount: ask.amount.toString() });
  return reply.quote;
}
