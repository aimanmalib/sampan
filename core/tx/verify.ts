// Runs a transaction through the libauth BCH virtual machine (2026 rules). Pure.
// Before signing only the contract inputs can pass (user inputs carry no signature yet), so the caller
// names the inputs to evaluate; after signing, verifyTransaction checks the whole transaction.
import { createVirtualMachineBch2026, type Output } from '@bitauth/libauth';
import type { Tx } from './types.js';

const vm = createVirtualMachineBch2026();

export type VmResult = { ok: true } | { ok: false; error: string };

export const verifyTransaction = (transaction: Tx, sourceOutputs: Output[]): VmResult => {
  const r = vm.verify({ transaction, sourceOutputs });
  return r === true ? { ok: true } : { ok: false, error: r };
};

export const verifyInputs = (transaction: Tx, sourceOutputs: Output[], inputIndexes: number[]): VmResult => {
  if (sourceOutputs.length !== transaction.inputs.length) return { ok: false, error: 'source output count differs from input count' };
  for (const inputIndex of inputIndexes) {
    const state = vm.evaluate({ inputIndex, sourceOutputs, transaction });
    const r = vm.stateSuccess(state);
    if (r !== true) return { ok: false, error: `input ${inputIndex}: ${r}` };
  }
  return { ok: true };
};
