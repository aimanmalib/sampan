// The headless test wallet as a WizardConnect wallet: shares its xpubs, and answers a sign request only when
// the policy approves it. Never deployed; the phrase comes from the env file.
import { sha256, utf8ToBin } from '@bitauth/libauth';
import type { SignTransactionRequest } from '@wizardconnect/core';
import { DerivationPath, type WalletAdapter } from '@wizardconnect/wallet';
import { parseRelaySourceOutputs } from '../../core/client/relay.js';
import { signWithHdKeys, type HdKeys } from '../../core/client/session.js';
import { WALLET_PATHS, type WalletPath } from '../../core/wallet.js';
import { review, type SignAsk, type Verdict } from './policy.js';

const PATH_OF: Record<DerivationPath, WalletPath> = {
  [DerivationPath.Receive]: 'receive',
  [DerivationPath.Change]: 'change',
  [DerivationPath.Cauldron]: 'defi',
};

/** hdwalletv1 request -> the policy's view of it. Throws on anything malformed. */
export function askFromRequest(request: SignTransactionRequest): SignAsk & { prompt: string } {
  const t = request.transaction as unknown as { transaction: unknown; sourceOutputs: unknown; userPrompt?: unknown };
  if (typeof t.transaction !== 'string') throw new Error('the transaction must be hex');
  return {
    tx: t.transaction.toLowerCase(),
    sourceOutputs: parseRelaySourceOutputs(t.sourceOutputs),
    inputPaths: request.inputPaths.map(([inputIndex, name, index]) => {
      if (!(WALLET_PATHS as readonly string[]).includes(name)) throw new Error(`unknown path ${name}`);
      return { inputIndex, path: `${name}/${index}` };
    }),
    prompt: typeof t.userPrompt === 'string' ? t.userPrompt : '',
  };
}

export interface Decision {
  approve(ask: SignAsk & { prompt: string }): Verdict;
  signed(ask: SignAsk & { prompt: string }): void;
}

export function testWalletAdapter(keys: HdKeys, decision: Decision): WalletAdapter {
  return {
    walletName: 'Sampan test wallet',
    walletIcon: '',
    getRelayPrivateKey: (uri) => sha256.hash(utf8ToBin(`sampan test wallet relay ${uri} ${keys.xpub('receive')}`)),
    getPublicKey: (path, index) => keys.publicKey(PATH_OF[path], Number(index)),
    getXpub: (path) => keys.xpub(PATH_OF[path]),
    async signTransaction(request) {
      const ask = askFromRequest(request);
      const verdict = decision.approve(ask);
      if (!verdict.ok) throw new Error(`refused: ${verdict.reason}`);
      const signedTransaction = signWithHdKeys(keys, { ...ask, userPrompt: ask.prompt });
      decision.signed(ask);
      return { signedTransaction };
    },
  };
}

export { review };
