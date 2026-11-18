// Explorer links for the transactions of a crossing. Every host comes from config: connect.explorerTxUrl (Bitcoin
// Cash), thorchain.explorerTxUrl (THORChain; routeExplorerTxUrl in /api/config) and evm.chains[].explorer; none is
// written in code.
export interface ExplorerConfig {
  connect: { explorerTxUrl: string };
  routeExplorerTxUrl: string;
  evm: { chains: ReadonlyArray<{ key: string; explorer: string }> };
}

/** The route's chain name (BCH, THOR, ETH, BASE, …) and a transaction id as the route gives it. Null: no explorer known. */
export function txUrl(c: ExplorerConfig, chain: string, txid: string): string | null {
  const bare = txid.replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(bare)) return null;
  const key = chain.toUpperCase();
  if (key === 'BCH') return c.connect.explorerTxUrl.replace('{txid}', bare);
  if (key === 'THOR') return c.routeExplorerTxUrl.replace('{txid}', bare);
  const evm = c.evm.chains.find((ch) => ch.key.toUpperCase() === key);
  return evm ? `${evm.explorer}/tx/0x${bare}` : null;
}

/** A transaction id as the receipt prints it in full: lower case, 0x on EVM chains. */
export const fullTxid = (chain: string, txid: string): string => {
  const bare = txid.replace(/^0x/i, '').toLowerCase();
  const key = chain.toUpperCase();
  return key === 'BCH' || key === 'THOR' ? bare : `0x${bare}`;
};
