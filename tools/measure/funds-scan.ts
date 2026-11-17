// Pure parts of tools/measure/funds.ts: walk one derivation path until the gap limit, add up coins, and write the
// rows of the "Test wallet funds" table in docs/OPERATIONS.md. No network here; the CLI passes the lookups in.
import { formatUnits } from '../../core/wallet.js';

export interface FundsCoin {
  sats: bigint;
  token?: { category: string; amount: bigint };
}

export interface AddressLookup {
  used: boolean;
  coins: FundsCoin[];
}

/**
 * Looks addresses up from index 0 and stops after `gap` unused addresses in a row (the usual wallet gap limit).
 * Returns every coin found and the number of addresses looked at.
 */
export async function walkPath(lookup: (index: number) => Promise<AddressLookup>, gap: number, max = 1000): Promise<{ coins: FundsCoin[]; looked: number }> {
  const coins: FundsCoin[] = [];
  let unused = 0;
  let i = 0;
  for (; i < max && unused < gap; i++) {
    const a = await lookup(i);
    coins.push(...a.coins);
    unused = a.used || a.coins.length > 0 ? 0 : unused + 1;
  }
  return { coins, looked: i };
}

export interface CoinTotals {
  /** Satoshis of coins without tokens: what the wallet can spend on swaps and fees. */
  plainSats: bigint;
  /** Satoshis held by token coins (dust under each token output). */
  tokenSats: bigint;
  tokens: Map<string, bigint>;
}

export function sumCoins(coins: FundsCoin[]): CoinTotals {
  const t: CoinTotals = { plainSats: 0n, tokenSats: 0n, tokens: new Map() };
  for (const c of coins) {
    if (!c.token) {
      t.plainSats += c.sats;
      continue;
    }
    t.tokenSats += c.sats;
    const key = c.token.category.toLowerCase();
    t.tokens.set(key, (t.tokens.get(key) ?? 0n) + c.token.amount);
  }
  return t;
}

export interface FundsRow {
  utc: string;
  wallet: string;
  asset: string;
  balance: string;
  needed: string;
  why: string;
}

export interface BalanceInput {
  utc: string;
  bchWallet: string;
  evmWallet: string;
  totals: CoinTotals;
  /** category (any case) → symbol and decimals of the configured tokens */
  tokens: Array<{ symbol: string; category: string; decimals: number }>;
  /** One entry per configured EVM chain: its gas coin balance and each configured token's units and decimals. */
  evm: Array<{ chain: string; native: string; balance: bigint | undefined; tokens: Array<{ symbol: string; units: bigint | undefined; decimals: number }> }>;
  /** What each asset is needed for until the end of judging; the same text for every row unless given per asset. */
  needed: (asset: string) => { needed: string; why: string };
}

const unknown = 'not read';

export function fundsRows(b: BalanceInput): FundsRow[] {
  const row = (wallet: string, asset: string, balance: string): FundsRow => ({ utc: b.utc, wallet, asset, balance, ...b.needed(asset) });
  const rows = [row(b.bchWallet, 'BCH', `${formatUnits(b.totals.plainSats, 8)} BCH (${b.totals.plainSats} sats)`)];
  for (const t of b.tokens) {
    const amount = b.totals.tokens.get(t.category.toLowerCase()) ?? 0n;
    rows.push(row(b.bchWallet, t.symbol, `${formatUnits(amount, t.decimals, t.decimals)} ${t.symbol}`));
  }
  for (const c of b.evm) {
    rows.push(row(b.evmWallet, `${c.native} (${c.chain})`, c.balance === undefined ? unknown : `${formatUnits(c.balance, 18)} ${c.native}`));
    for (const t of c.tokens) rows.push(row(b.evmWallet, `${t.symbol} (${c.chain})`, t.units === undefined ? unknown : `${formatUnits(t.units, t.decimals, 2)} ${t.symbol}`));
  }
  return rows;
}

export const fundsTableHeader = ['| UTC | wallet | asset | balance | needed until 2026-11-28 | why |', '| --- | --- | --- | --- | --- | --- |'];

export const fundsLine = (r: FundsRow): string => `| ${r.utc} | \`${r.wallet}\` | ${r.asset} | ${r.balance} | ${r.needed} | ${r.why} |`;
