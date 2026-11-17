// A payment of fungible tokens plus BCH to one address (the atomic swap contract for PUSD to USDC), from a wallet's
// coins. Token coins of that category only, largest first, then plain coins for the BCH and the fee; other token
// categories and NFTs are never spent. Token change goes back to the wallet with the token dust, BCH change likewise.
// Pure; the caller checks, signs and sends.
import { encodeTransaction, hexToBin, type Output } from '@bitauth/libauth';
import type { Payment } from './payment.js';
import { BCH_DUST_SATS, P2PKH_UNLOCK_SIZE, type Tx } from './types.js';

export interface TokenWalletCoin {
  txid: string;
  vout: number;
  sats: bigint;
  lockingHex: string;
  /** Wallet path, e.g. "receive/3". */
  path: string;
  token?: { category: string; amount: bigint; nft: boolean };
}

export interface TokenPaymentParams {
  coins: TokenWalletCoin[];
  to: { lockingHex: string; sats: bigint; category: string; amount: bigint };
  /** Wallet address for the token change (P2PKH). */
  tokenChangeLockingHex: string;
  /** BCH carried by the token change output. */
  tokenDustSats: bigint;
  changeLockingHex: string;
  satsPerByte: bigint;
}

export class TokenPaymentError extends Error {}

const bySatsDesc = (a: TokenWalletCoin, b: TokenWalletCoin): number => (a.sats === b.sats ? 0 : a.sats > b.sats ? -1 : 1);
const byTokenDesc = (a: TokenWalletCoin, b: TokenWalletCoin): number => {
  const x = a.token!.amount;
  const y = b.token!.amount;
  return x === y ? 0 : x > y ? -1 : 1;
};

export function buildTokenPayment(p: TokenPaymentParams): Payment {
  const category = p.to.category.toLowerCase();
  if (p.to.amount <= 0n) throw new TokenPaymentError('the token amount must be positive');
  if (p.to.sats < BCH_DUST_SATS) throw new TokenPaymentError('the output carries too little BCH');
  const tokenCoins = p.coins.filter((c) => c.token && !c.token.nft && c.token.category.toLowerCase() === category).sort(byTokenDesc);
  const plain = p.coins.filter((c) => !c.token).sort(bySatsDesc);

  const picked: TokenWalletCoin[] = [];
  let tokens = 0n;
  for (const c of tokenCoins) {
    if (tokens >= p.to.amount) break;
    picked.push(c);
    tokens += c.token!.amount;
  }
  if (tokens < p.to.amount) throw new TokenPaymentError('not enough of this token in the wallet');
  const tokenChange = tokens - p.to.amount;
  const categoryBin = hexToBin(category);

  const make = (change: bigint, unlockSize: number): Tx => ({
    version: 2,
    locktime: 0,
    inputs: picked.map((c) => ({ outpointTransactionHash: hexToBin(c.txid), outpointIndex: c.vout, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array(unlockSize) })),
    outputs: [
      { lockingBytecode: hexToBin(p.to.lockingHex), valueSatoshis: p.to.sats, token: { category: categoryBin, amount: p.to.amount } },
      ...(tokenChange > 0n
        ? [{ lockingBytecode: hexToBin(p.tokenChangeLockingHex), valueSatoshis: p.tokenDustSats, token: { category: categoryBin, amount: tokenChange } }]
        : []),
      ...(change > 0n ? [{ lockingBytecode: hexToBin(p.changeLockingHex), valueSatoshis: change }] : []),
    ],
  });
  const outSats = p.to.sats + (tokenChange > 0n ? p.tokenDustSats : 0n);
  const total = () => picked.reduce((s, c) => s + c.sats, 0n);

  // Token coins first (they must be spent), then plain coins until the BCH covers the outputs and the fee.
  let next = 0;
  for (;;) {
    const fee = BigInt(encodeTransaction(make(1n, P2PKH_UNLOCK_SIZE)).length) * p.satsPerByte;
    const change = total() - outSats - fee;
    if (change >= 0n) {
      const keep = change >= BCH_DUST_SATS ? change : 0n;
      const tx = make(keep, 0);
      return {
        transaction: tx,
        sourceOutputs: picked.map(
          (c): Output => ({
            lockingBytecode: hexToBin(c.lockingHex),
            valueSatoshis: c.sats,
            ...(c.token ? { token: { category: hexToBin(c.token.category.toLowerCase()), amount: c.token.amount } } : {}),
          }),
        ),
        inputPaths: picked.map((c, inputIndex) => ({ inputIndex, path: c.path })),
        feeSats: total() - outSats - keep,
      };
    }
    const coin = plain[next++];
    if (!coin) throw new TokenPaymentError('not enough plain BCH in the wallet for this payment and its fee');
    picked.push(coin);
  }
}
