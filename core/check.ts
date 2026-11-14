// checkTransaction: the browser's own review of a server-built transaction before any wallet sees it.
// Pure, rules 1-5 of the product spec. Source outputs come from the server too, but wallets sign with
// SIGHASH_UTXOS, so a lie about them makes every signature invalid rather than moving funds.
import { binToHex, type Output } from '@bitauth/libauth';
import { poolV0LockingHex } from './pools/template.js';
import type { Tx } from './tx/types.js';

export const BCH = 'BCH' as const;

export interface Expectation {
  /** Locking bytecodes (hex) derived in the browser from this session's xpubs. */
  userLockingBytecodes: string[];
  /** Inputs the wallet is asked to sign. */
  inputPaths: Array<{ inputIndex: number; path: string }>;
  /** Owner hashes (hex) of the pools the quote used; their locking bytecode is rebuilt here. */
  poolOwnerPkhs: string[];
  /** Exchange deposit or vault outputs: exact amount, no token. */
  deposits?: Array<{ lockingBytecode: string; sats: bigint }>;
  /** Expected OP_RETURN output (hex locking bytecode), byte for byte. */
  opReturn?: string;
  /** What the user was shown as leaving the wallet. */
  spend: { sats: bigint; tokens: Record<string, bigint> };
  feeCapSats: bigint;
  /** The minimum the user was shown as receiving (category hex, or BCH). */
  receive: { category: string; min: bigint };
}

export type CheckResult = { ok: true } | { ok: false; rule: 1 | 2 | 3 | 4 | 5; reason: string };

const fail = (rule: 1 | 2 | 3 | 4 | 5, reason: string): CheckResult => ({ ok: false, rule, reason });
const hex = (b: Uint8Array): string => binToHex(b);
const catOf = (o: Output): string | undefined => (o.token ? hex(o.token.category) : undefined);

interface Flow {
  sats: bigint;
  tokens: Map<string, bigint>;
}
const addFlow = (f: Flow, o: Output, sign: 1n | -1n): void => {
  f.sats += sign * o.valueSatoshis;
  const c = catOf(o);
  if (c && o.token) f.tokens.set(c, (f.tokens.get(c) ?? 0n) + sign * o.token.amount);
};

export const checkTransaction = (tx: Tx, sourceOutputs: Output[], e: Expectation): CheckResult => {
  if (tx.version !== 2) return fail(5, 'transaction version is not 2');
  if (tx.locktime !== 0) return fail(5, 'locktime is not 0');
  if (sourceOutputs.length !== tx.inputs.length) return fail(5, 'source outputs do not match inputs');

  const user = new Set(e.userLockingBytecodes.map((s) => s.toLowerCase()));
  const poolLocks = new Set(e.poolOwnerPkhs.map((p) => poolV0LockingHex(p)));
  const signed = new Map<number, string>();
  for (const p of e.inputPaths) {
    if (signed.has(p.inputIndex)) return fail(5, `input ${p.inputIndex} listed twice`);
    signed.set(p.inputIndex, p.path);
  }

  // Rule 5: every input is a pool spent through its exchange path or a listed coin of this user.
  const poolIndexes = new Set<number>();
  for (const [i, src] of sourceOutputs.entries()) {
    const lock = hex(src.lockingBytecode);
    if (signed.has(i)) {
      if (!user.has(lock)) return fail(5, `input ${i} is listed for signing but is not the user's`);
      continue;
    }
    if (user.has(lock)) return fail(5, `input ${i} spends the user's coin without being listed`);
    if (!poolLocks.has(lock)) return fail(5, `input ${i} is neither a quoted pool nor a user coin`);
    poolIndexes.add(i);
  }
  for (const i of signed.keys()) if (i < 0 || i >= tx.inputs.length) return fail(5, `listed input ${i} does not exist`);

  // Rule 1 and 3: every output is a pool continuation, the user's own, an expected deposit or the memo.
  const deposits = new Map((e.deposits ?? []).map((d) => [d.lockingBytecode.toLowerCase(), d.sats]));
  const userFlow: Flow = { sats: 0n, tokens: new Map() };
  for (const [i, out] of tx.outputs.entries()) {
    const lock = hex(out.lockingBytecode);
    if (poolIndexes.has(i)) {
      const src = sourceOutputs[i] as Output;
      if (lock !== hex(src.lockingBytecode) || catOf(out) !== catOf(src))
        return fail(1, `output ${i} does not continue the pool spent at the same index`);
      if (out.token?.nft || src.token?.nft) return fail(1, `output ${i} moves an NFT`);
      continue;
    }
    if (user.has(lock)) {
      addFlow(userFlow, out, 1n);
      continue;
    }
    if (deposits.has(lock)) {
      if (out.token) return fail(3, `deposit output ${i} carries a token`);
      if (out.valueSatoshis !== deposits.get(lock)) return fail(3, `deposit output ${i} is not the quoted amount`);
      deposits.delete(lock);
      continue;
    }
    if (e.opReturn !== undefined && lock === e.opReturn.toLowerCase() && out.valueSatoshis === 0n && !out.token) continue;
    return fail(1, `output ${i} pays an address that is not part of this action`);
  }
  for (const i of poolIndexes) if (i >= tx.outputs.length) return fail(1, `pool input ${i} has no output at the same index`);
  if (deposits.size > 0) return fail(3, 'an expected deposit output is missing');

  // Rule 2: what leaves the wallet is no more than what was shown, plus a capped fee.
  for (const i of signed.keys()) addFlow(userFlow, sourceOutputs[i] as Output, -1n);
  const totalIn = sourceOutputs.reduce((s, o) => s + o.valueSatoshis, 0n);
  const totalOut = tx.outputs.reduce((s, o) => s + o.valueSatoshis, 0n);
  if (totalIn - totalOut > e.feeCapSats) return fail(2, 'network fee is above the cap');
  if (-userFlow.sats > e.spend.sats + e.feeCapSats) return fail(2, 'more BCH leaves the wallet than was shown');
  for (const [cat, net] of userFlow.tokens) {
    const shown = e.spend.tokens[cat] ?? 0n;
    if (-net > shown) return fail(2, 'more tokens leave the wallet than were shown');
  }

  // Rule 4: the user receives at least the minimum shown.
  const gained = e.receive.category === BCH ? userFlow.sats : (userFlow.tokens.get(e.receive.category.toLowerCase()) ?? 0n);
  if (gained < e.receive.min) return fail(4, 'the wallet receives less than the minimum shown');
  return { ok: true };
};
