// WalletConnect for EVM wallets on another device or app (PRD 4.14): the official EIP-1193 provider, loaded only
// when config.evm.walletConnect is set and the user picks it. Sampan draws the pairing QR itself (no vendor modal),
// talks to the configured relay only, and sends no telemetry. Under SAMPAN_FAKE the e2e stand-in is loaded instead.
import type { WalletConnectOptions } from '../../../core/client/walletconnect';
import type { EvmProvider } from './store';

export interface WalletConnectProvider extends EvmProvider {
  /** Opens a pairing; `onUri` gets the wc: link to show as a QR code. Resolves with the accounts once approved. */
  pair(onUri: (uri: string) => void): Promise<string[]>;
  disconnect(): Promise<void>;
}

async function official(o: WalletConnectOptions): Promise<WalletConnectProvider> {
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  const [first, ...rest] = o.chains.map((c) => c.id);
  const provider = await EthereumProvider.init({
    projectId: o.projectId,
    relayUrl: o.relayUrl,
    showQrModal: false,
    optionalChains: [first ?? 1, ...rest],
    rpcMap: Object.fromEntries(o.chains.map((c) => [c.id, c.rpc])),
    metadata: o.metadata,
    // Read by the universal provider: no events are sent to the vendor's analytics endpoint.
    ...({ telemetryEnabled: false } as object),
  });
  return Object.assign(provider, {
    async pair(onUri: (uri: string) => void): Promise<string[]> {
      provider.on('display_uri', onUri);
      try {
        return await provider.enable();
      } finally {
        provider.removeListener('display_uri', onUri);
      }
    },
  }) as unknown as WalletConnectProvider;
}

let loading: Promise<WalletConnectProvider> | null = null;

/** The provider, created once per page; a failed load can be tried again. */
export function loadWalletConnect(o: WalletConnectOptions, fake: boolean): Promise<WalletConnectProvider> {
  loading ??= (fake ? import('./wcFake').then((m) => m.fakeWalletConnect()) : official(o)).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}
