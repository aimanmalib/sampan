// WizardConnect as a WalletSession: public keys come from the xpubs the wallet shared, and signing sends an
// hdwalletv1 sign request (transaction as hex, source outputs in the relay format, broadcast off).
import { CHILD_INDEX, toWizardInputPaths, type WalletPath } from '../../../core/wallet';
import type { WalletSession } from '../../../core/client/session';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import { relaySourceOutputs } from '../../../core/client/relay';

export function wizardSession(manager: DappConnectionManager, name: string | null): WalletSession {
  return {
    name,
    publicKey: (path: WalletPath, index: number) => manager.getPubkey(CHILD_INDEX[path], BigInt(index)),
    async sign(request) {
      const response = await manager.signTransaction({
        // The request crosses the relay as JSON, so bytes and bigints go in the relay format.
        transaction: {
          transaction: request.tx,
          sourceOutputs: relaySourceOutputs(request),
          broadcast: false,
          userPrompt: request.userPrompt,
        } as unknown as Parameters<DappConnectionManager['signTransaction']>[0]['transaction'],
        inputPaths: toWizardInputPaths(request.inputPaths),
      });
      if (response.error) throw new Error(response.error);
      if (!/^[0-9a-f]+$/i.test(response.signedTransaction ?? '')) throw new Error('the wallet returned no signed transaction');
      return response.signedTransaction.toLowerCase();
    },
  };
}
