import { describe, expect, it } from 'vitest';
import { FAKE_WALLET_PHRASE } from '../core/client/fake-wallet.js';
import { hdKeysFromPhrase, signWithHdKeys } from '../core/client/session.js';
import { verifyTransaction } from '../core/tx/verify.js';
import { deriveAddress } from '../core/wallet.js';
import { outputToWire, txFromHex, txToHex } from '../core/wire.js';
import { buildPayment, type WalletCoin } from '../tools/test-wallet/payment.js';

const keys = hdKeysFromPhrase(FAKE_WALLET_PHRASE);
const addr = (path: 'receive' | 'change', i: number) => deriveAddress(keys.publicKey(path, i), path, i, 'bitcoincash');
const coin = (n: number, sats: bigint, hasToken = false, path: 'receive' | 'change' = 'receive'): WalletCoin => ({
  txid: n.toString(16).padStart(64, '0'),
  vout: 0,
  sats,
  lockingHex: addr(path, n).lockingHex,
  path: `${path}/${n}`,
  hasToken,
});
const to = addr('receive', 30).lockingHex;
const change = addr('change', 0).lockingHex;

describe('test wallet payment', () => {
  it('pays from the largest plain coins, leaves token coins alone and returns change; the signed transaction passes the VM', () => {
    const coins = [coin(1, 50_000n), coin(2, 900_000n, true), coin(3, 400_000n, false, 'change')];
    const pay = buildPayment({ coins, toLockingHex: to, sats: 300_000n, changeLockingHex: change, satsPerByte: 1n });
    expect(pay.inputPaths).toEqual([{ inputIndex: 0, path: 'change/3' }]);
    expect(pay.transaction.outputs.map((o) => o.valueSatoshis)).toEqual([300_000n, 400_000n - 300_000n - pay.feeSats]);
    expect(pay.feeSats).toBeGreaterThan(150n);
    expect(pay.feeSats).toBeLessThan(300n);
    const signed = signWithHdKeys(keys, { tx: txToHex(pay.transaction), sourceOutputs: pay.sourceOutputs.map(outputToWire), inputPaths: pay.inputPaths, userPrompt: '' });
    expect(verifyTransaction(txFromHex(signed), pay.sourceOutputs)).toEqual({ ok: true });
  });

  it('adds coins until the amount and fee are covered, and folds dust change into the fee', () => {
    const pay = buildPayment({ coins: [coin(1, 100_000n), coin(2, 1_000n)], toLockingHex: to, sats: 100_500n, changeLockingHex: change, satsPerByte: 1n });
    expect(pay.inputPaths).toHaveLength(2);
    expect(pay.transaction.outputs).toHaveLength(1);
    expect(pay.feeSats).toBe(500n);
  });

  it('refuses dust amounts and amounts above the plain coins', () => {
    expect(() => buildPayment({ coins: [coin(1, 10_000n)], toLockingHex: to, sats: 100n, changeLockingHex: change, satsPerByte: 1n })).toThrow(/below/);
    expect(() => buildPayment({ coins: [coin(1, 10_000n), coin(2, 1_000_000n, true)], toLockingHex: to, sats: 20_000n, changeLockingHex: change, satsPerByte: 1n })).toThrow(/not enough/);
  });
});
