// The PUSD payment to an atomic swap contract (P2SH32 output with tokens) and checkTransaction's token deposit, on
// throwaway keys.
import { binToHex } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { checkTransaction, type Expectation } from '../check.js';
import { PUSD, testKey, userLock } from '../../tests/helpers/pools.js';
import { contractLock } from '../client/atom-pay.js';
import { signP2pkhInputs } from './sign.js';
import { buildTokenPayment, TokenPaymentError, type TokenWalletCoin } from './token-payment.js';
import { verifyTransaction } from './verify.js';

const user = binToHex(userLock);
const CONTRACT = `aa20${'5c'.repeat(32)}87`;
const OTHER = 'ee'.repeat(32);
const coin = (vout: number, sats: bigint, token?: { category: string; amount: bigint; nft?: boolean }): TokenWalletCoin => ({
  txid: 'ab'.repeat(32),
  vout,
  sats,
  lockingHex: user,
  path: `receive/${vout}`,
  ...(token ? { token: { category: token.category, amount: token.amount, nft: token.nft ?? false } } : {}),
});
const params = (coins: TokenWalletCoin[], amount = 2_000_000n) => ({
  coins,
  to: { lockingHex: CONTRACT, sats: 2000n, category: PUSD, amount },
  tokenChangeLockingHex: user,
  tokenDustSats: 1000n,
  changeLockingHex: user,
  satsPerByte: 1n,
});
const expectation = (b: { inputPaths: Array<{ inputIndex: number; path: string }> }, amount = 2_000_000n, over: Partial<Expectation> = {}): Expectation => ({
  userLockingBytecodes: [user],
  inputPaths: b.inputPaths,
  poolOwnerPkhs: [],
  deposits: [{ lockingBytecode: CONTRACT, sats: 2000n, token: { category: PUSD, amount } }],
  spend: { sats: 2000n, tokens: { [PUSD.toLowerCase()]: amount } },
  feeCapSats: 5000n,
  ...over,
});

describe('token payment to a swap contract', () => {
  it('spends only coins of that category and plain coins, returns token and BCH change, and passes the check and the VM', () => {
    const coins = [
      coin(0, 1000n, { category: PUSD, amount: 1_500_000n }),
      coin(1, 1000n, { category: PUSD, amount: 1_000_000n }),
      coin(2, 1000n, { category: OTHER, amount: 9n }),
      coin(3, 1000n, { category: PUSD, amount: 1n, nft: true }),
      coin(4, 50_000n),
    ];
    const p = buildTokenPayment(params(coins));
    expect(p.inputPaths.map((i) => i.path)).toEqual(['receive/0', 'receive/1', 'receive/4']);
    const [contract, tokenChange, change] = p.transaction.outputs;
    expect(binToHex(contract!.lockingBytecode)).toBe(CONTRACT);
    expect([contract!.valueSatoshis, contract!.token?.amount]).toEqual([2000n, 2_000_000n]);
    expect([tokenChange!.valueSatoshis, tokenChange!.token?.amount]).toEqual([1000n, 500_000n]);
    expect(change!.token).toBeUndefined();
    expect(checkTransaction(p.transaction, p.sourceOutputs, expectation(p))).toEqual({ ok: true });
    const signed = signP2pkhInputs(p.transaction, p.sourceOutputs, [0, 1, 2], testKey);
    expect(verifyTransaction(signed, p.sourceOutputs).ok).toBe(true);
  });

  it('refuses when the wallet lacks the token or the BCH for the payment', () => {
    expect(() => buildTokenPayment(params([coin(0, 50_000n, { category: PUSD, amount: 10n }), coin(1, 50_000n)]))).toThrow(TokenPaymentError);
    expect(() => buildTokenPayment(params([coin(0, 1000n, { category: PUSD, amount: 2_000_000n })]))).toThrow('not enough plain BCH');
  });

  it('fails the check when the contract output carries another token amount or none', () => {
    const p = buildTokenPayment(params([coin(0, 1000n, { category: PUSD, amount: 3_000_000n }), coin(1, 50_000n)]));
    expect(checkTransaction(p.transaction, p.sourceOutputs, expectation(p, 1_000_000n))).toMatchObject({ ok: false, rule: 3 });
    const plain = expectation(p, 0n, { deposits: [{ lockingBytecode: CONTRACT, sats: 2000n }] });
    expect(checkTransaction(p.transaction, p.sourceOutputs, plain)).toMatchObject({ ok: false, rule: 3, reason: expect.stringContaining('carries a token') });
  });

  it('takes only token-aware P2SH32 contract addresses on the expected network', () => {
    const p2sh32 = 'bitcoincash:rdw9chzut3w9chzut3w9chzut3w9chzut3w9chzut3w9chzut3w9cfsqn8n7y';
    expect(contractLock(p2sh32, 'bitcoincash')).toBe(CONTRACT);
    expect(contractLock(p2sh32, 'bchtest')).toBeNull();
    expect(contractLock('bitcoincash:pdw9chzut3w9chzut3w9chzut3w9chzut3w9chzut3w9chzut3w9cmruj7j80', 'bitcoincash')).toBeNull();
    expect(contractLock('bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt', 'bitcoincash')).toBeNull();
  });
});
