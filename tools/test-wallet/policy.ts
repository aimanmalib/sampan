// When the headless test wallet may sign: the request must pass the same checkTransaction the page runs,
// rebuilt from what the caller intended, and stay inside the test budget. Pure.
import { hexToBin } from '@bitauth/libauth';
import { checkTransaction, type Expectation } from '../../core/check.js';
import { poolV0OwnerOf } from '../../core/pools/template.js';
import { outputFromWire, txFromHex, type WireOutput } from '../../core/wire.js';

/** What the measuring script asked for: the amounts it showed and their value in USD. */
export interface Intent {
  spend: { sats: string; tokens?: Record<string, string> };
  receive: { category: string; min: string };
  usd: number;
}

export interface Budget {
  maxUsdPerTx: number;
  maxUsdPerDay: number;
}

export interface SignAsk {
  tx: string;
  sourceOutputs: WireOutput[];
  inputPaths: Array<{ inputIndex: number; path: string }>;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

export function review(
  ask: SignAsk,
  ctx: { ownLocks: string[]; intent: Intent; budget: Budget; spentTodayUsd: number; feeCapSats: bigint },
): Verdict {
  const { intent, budget } = ctx;
  if (!(intent.usd > 0)) return { ok: false, reason: 'intent has no USD value' };
  if (intent.usd > budget.maxUsdPerTx) return { ok: false, reason: `USD ${intent.usd} is above the per-transaction limit ${budget.maxUsdPerTx}` };
  if (ctx.spentTodayUsd + intent.usd > budget.maxUsdPerDay)
    return { ok: false, reason: `USD ${intent.usd} would pass the daily limit ${budget.maxUsdPerDay} (spent ${ctx.spentTodayUsd})` };

  const tx = txFromHex(ask.tx);
  const listed = new Set(ask.inputPaths.map((p) => p.inputIndex));
  const poolOwnerPkhs: string[] = [];
  for (const [i, input] of tx.inputs.entries()) {
    if (listed.has(i)) continue;
    const src = ask.sourceOutputs[i];
    const owner = src ? poolV0OwnerOf(input.unlockingBytecode, hexToBin(src.lockingBytecode)) : undefined;
    if (!owner) return { ok: false, reason: `input ${i} is neither listed for signing nor a Cauldron pool` };
    poolOwnerPkhs.push(owner);
  }
  const expectation: Expectation = {
    userLockingBytecodes: ctx.ownLocks,
    inputPaths: ask.inputPaths,
    poolOwnerPkhs,
    spend: {
      sats: BigInt(intent.spend.sats),
      tokens: Object.fromEntries(Object.entries(intent.spend.tokens ?? {}).map(([k, v]) => [k.toLowerCase(), BigInt(v)])),
    },
    feeCapSats: ctx.feeCapSats,
    receive: { category: intent.receive.category.toLowerCase(), min: BigInt(intent.receive.min) },
  };
  const res = checkTransaction(tx, ask.sourceOutputs.map(outputFromWire), expectation);
  return res.ok ? res : { ok: false, reason: `checkTransaction rule ${res.rule}: ${res.reason}` };
}
