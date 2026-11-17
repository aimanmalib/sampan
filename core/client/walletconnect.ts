// What the page hands WalletConnect's provider (PRD 4.14): the project id and relay from config, the chains the
// route offers (each with its first RPC from config), and the site's own name, description and icon. Pure.
import type { PublicConfig } from '../config.js';

export interface WalletConnectOptions {
  projectId: string;
  relayUrl: string;
  chains: Array<{ id: number; rpc: string }>;
  metadata: { name: string; description: string; url: string; icons: string[] };
}

/** Null when config has no project id: the option is not offered and the provider is never loaded. */
export function walletConnectOptions(config: PublicConfig, name: string, description: string, origin: string): WalletConnectOptions | null {
  const wc = config.evm.walletConnect;
  if (!wc) return null;
  const chains = config.evm.chains
    .filter((c) => config.routeChains.includes(c.key))
    .map((c) => ({ id: c.id, rpc: c.rpc[0]! }));
  return { ...wc, chains, metadata: { name, description, url: origin, icons: [`${origin}/favicon.svg`] } };
}
