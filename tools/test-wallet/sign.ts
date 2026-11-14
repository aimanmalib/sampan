// Signs the P2PKH inputs of an unsigned transaction with one private key (test wallet and unit tests).
// Never deployed. Signs with SIGHASH_ALL | FORKID (libauth P2PKH template); other inputs keep their
// pre-set unlocking bytecode.
import {
  generateTransaction,
  walletTemplateP2pkhNonHd,
  walletTemplateToCompilerBch,
  type Output,
} from '@bitauth/libauth';
import type { Tx } from '../../core/tx/types.js';

const compiler = walletTemplateToCompilerBch(walletTemplateP2pkhNonHd);

export const signP2pkhInputs = (transaction: Tx, sourceOutputs: Output[], inputIndexes: number[], privateKey: Uint8Array): Tx => {
  const sign = new Set(inputIndexes);
  const inputs = transaction.inputs.map((input, i) => {
    const src = sourceOutputs[i] as Output;
    if (!sign.has(i)) return input;
    return {
      outpointIndex: input.outpointIndex,
      outpointTransactionHash: input.outpointTransactionHash,
      sequenceNumber: input.sequenceNumber,
      unlockingBytecode: {
        compiler,
        data: { keys: { privateKeys: { key: privateKey } } },
        script: 'unlock',
        valueSatoshis: src.valueSatoshis,
        ...(src.token ? { token: src.token } : {}),
      },
    };
  });
  const result = generateTransaction({
    version: transaction.version,
    locktime: transaction.locktime,
    inputs,
    outputs: transaction.outputs,
  });
  if (!result.success) throw new Error(`signing failed: ${JSON.stringify(result.errors).slice(0, 300)}`);
  return result.transaction;
};
