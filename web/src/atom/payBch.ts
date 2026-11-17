// The payment step of PUSD to USDC for the connected BCH wallet: the swap client's payment request goes through
// core/client/atom-pay (built from the wallet's coins, checked in this browser, signed by the wallet, relayed by the
// server). Null while no wallet is connected and scanned.
import { payContract } from '../../../core/client/atom-pay';
import { prefixOf } from '../../../core/business';
import { api } from '../api';
import type { LoadedConfig } from '../config';
import type { Wallet } from '../wallet/useWallet';
import type { AtomPaymentRequest } from './client';

export function bchPayer(config: LoadedConfig, wallet: Wallet, prompt: (request: AtomPaymentRequest) => string): ((request: AtomPaymentRequest) => Promise<string>) | null {
  const { session, view } = wallet;
  if (!session || !view) return null;
  return async (request) => {
    try {
      return await payContract({
        api,
        session,
        wallet: view,
        payment: { address: request.address, tokenUnits: request.tokenUnits, category: request.category, sats: request.sats },
        prefix: prefixOf(view.receive.address),
        satsPerByte: BigInt(config.connect.satsPerByte),
        feeCapSats: BigInt(config.connect.feeCapSats),
        tokenDustSats: BigInt(config.connect.tokenDustSats),
        userPrompt: prompt(request),
      });
    } finally {
      wallet.refresh();
    }
  };
}
