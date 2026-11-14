// Finds the wallet's coins: derives addresses from the session's public keys in batches per path and asks the
// server for their history until every path has `gapLimit` unused addresses after the last used one.
import type { CashPrefix } from '../address.js';
import { deriveAddress, WALLET_PATHS, type DerivedAddress, type WalletPath } from '../wallet.js';
import type { Api } from './api.js';
import type { WalletSession } from './session.js';

export interface Coin {
  txid: string;
  vout: number;
  sats: bigint;
  token?: { category: string; amount: bigint; nft: boolean };
  address: DerivedAddress;
}

export interface WalletView {
  coins: Coin[];
  /** Every address derived during the scan (the "user's own" set for checkTransaction). */
  derived: DerivedAddress[];
  /** Next unused addresses for payouts and change. */
  receive: DerivedAddress;
  change: DerivedAddress;
  sats: bigint;
  /** Fungible token totals by category (lowercase hex). NFTs are never counted or spent. */
  tokens: Record<string, bigint>;
}

interface ScanReply {
  paths: Partial<
    Record<
      WalletPath,
      {
        more: boolean;
        addresses: Array<{
          address: string;
          used: boolean;
          utxos: Array<{ txid: string; vout: number; sats: string; token?: { category: string; amount: string; nft: boolean } }>;
        }>;
      }
    >
  >;
}

export async function scanWallet(
  api: Api,
  session: WalletSession,
  prefix: CashPrefix,
  opts: { gapLimit: number; maxRounds: number },
): Promise<WalletView> {
  const derived: DerivedAddress[] = [];
  const lastUsed: Record<WalletPath, number> = { receive: -1, change: -1, defi: -1 };
  const coins: Coin[] = [];
  const derive = (path: WalletPath, index: number): DerivedAddress | undefined => {
    const pub = session.publicKey(path, index);
    return pub ? deriveAddress(pub, path, index, prefix) : undefined;
  };
  let pending = WALLET_PATHS.filter((p) => derive(p, 0) !== undefined);
  for (let round = 0, start = 0; pending.length > 0 && round < opts.maxRounds; round++, start += opts.gapLimit) {
    const batch = new Map<WalletPath, DerivedAddress[]>();
    for (const path of pending) {
      const list = Array.from({ length: opts.gapLimit }, (_, i) => derive(path, start + i)).filter((a): a is DerivedAddress => !!a);
      batch.set(path, list);
      derived.push(...list);
    }
    const reply = await api.post<ScanReply>('/api/wallet/scan', {
      start,
      paths: Object.fromEntries([...batch].map(([p, list]) => [p, list.map((a) => a.address)])),
    });
    const next: WalletPath[] = [];
    for (const [path, list] of batch) {
      const r = reply.paths[path];
      if (!r) continue;
      r.addresses.forEach((a, i) => {
        const mine = list[i];
        if (!mine || a.address !== mine.address) throw new Error('scan reply does not match the addresses sent');
        if (a.used) lastUsed[path] = Math.max(lastUsed[path], mine.index);
        for (const u of a.utxos)
          coins.push({
            txid: u.txid,
            vout: u.vout,
            sats: BigInt(u.sats),
            ...(u.token ? { token: { category: u.token.category.toLowerCase(), amount: BigInt(u.token.amount), nft: u.token.nft } } : {}),
            address: mine,
          });
      });
      if (r.more) next.push(path);
    }
    pending = next;
  }
  const receive = derive('receive', lastUsed.receive + 1);
  const change = derive('change', lastUsed.change + 1) ?? receive;
  if (!receive || !change) throw new Error('the wallet shared no receiving keys');
  for (const a of [receive, change]) if (!derived.some((d) => d.lockingHex === a.lockingHex)) derived.push(a);
  const tokens: Record<string, bigint> = {};
  let sats = 0n;
  for (const c of coins) {
    if (c.token?.nft) continue;
    if (c.token) tokens[c.token.category] = (tokens[c.token.category] ?? 0n) + c.token.amount;
    else sats += c.sats;
  }
  return { coins, derived, receive, change, sats, tokens };
}
