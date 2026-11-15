// The THORChain deposit shape and checkTransaction rule 6, on throwaway keys.
import { binToHex, hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { checkTransaction, type Expectation } from '../check.js';
import { opReturnHex } from '../routes/memo.js';
import { otherLock, PUSD, testKey, userLock } from '../../tests/helpers/pools.js';
import { buildDeposit, depositSize, DepositBuildError } from './deposit.js';
import type { WalletCoin } from './payment.js';
import { signP2pkhInputs } from './sign.js';
import { verifyTransaction } from './verify.js';

const user = binToHex(userLock);
const vault = binToHex(otherLock);
const MEMO = '=:BASE.USDC:0x1a877169bB03400fA69EC4813889E78994D194Cb:181757716';
const coin = (vout: number, sats: bigint, extra: Partial<WalletCoin> = {}): WalletCoin => ({
  txid: 'ab'.repeat(32),
  vout,
  sats,
  lockingHex: user,
  path: `receive/${vout}`,
  hasToken: false,
  ...extra,
});

const expectation = (sats: bigint, over: Partial<Expectation> = {}): Expectation => ({
  userLockingBytecodes: [user],
  inputPaths: [{ inputIndex: 0, path: 'receive/0' }],
  poolOwnerPkhs: [],
  deposits: [{ lockingBytecode: vault, sats }],
  opReturn: opReturnHex(MEMO),
  thorDeposit: true,
  spend: { sats, tokens: {} },
  feeCapSats: 5000n,
  receive: { category: PUSD, min: 0n },
  ...over,
});

describe('THORChain deposit', () => {
  it('pays the vault first, change to input 0, memo last, and passes the check and the VM', () => {
    const d = buildDeposit({ coins: [coin(0, 500_000n)], vaultLockingHex: vault, sats: 400_000n, memo: MEMO, satsPerByte: 3n });
    const outs = d.transaction.outputs;
    expect(outs.map((o) => binToHex(o.lockingBytecode))).toEqual([vault, user, opReturnHex(MEMO)]);
    expect(outs[0]!.valueSatoshis).toBe(400_000n);
    expect(outs[2]!.valueSatoshis).toBe(0n);
    expect(outs[1]!.valueSatoshis).toBe(500_000n - 400_000n - d.feeSats);
    expect(d.feeSats).toBe(BigInt(depositSize(1, MEMO)) * 3n);
    expect(checkTransaction(d.transaction, d.sourceOutputs, expectation(400_000n))).toEqual({ ok: true });
    const signed = signP2pkhInputs(d.transaction, d.sourceOutputs, [0], testKey);
    expect(verifyTransaction(signed, d.sourceOutputs).ok).toBe(true);
  });

  it('adds coins after input 0 when one is not enough, change still to input 0', () => {
    const first = coin(0, 300_000n);
    const d = buildDeposit({ coins: [first, coin(1, 300_000n, { lockingHex: user })], vaultLockingHex: vault, sats: 400_000n, memo: MEMO, satsPerByte: 1n });
    expect(d.transaction.inputs).toHaveLength(2);
    expect(binToHex(d.transaction.outputs[1]!.lockingBytecode)).toBe(first.lockingHex);
  });

  it('never spends token coins or leaves change below dust', () => {
    expect(() => buildDeposit({ coins: [coin(0, 500_000n, { hasToken: true })], vaultLockingHex: vault, sats: 1000n, memo: MEMO, satsPerByte: 1n })).toThrow(DepositBuildError);
    expect(() => buildDeposit({ coins: [coin(0, 400_500n)], vaultLockingHex: vault, sats: 400_000n, memo: MEMO, satsPerByte: 1n })).toThrow(/change/);
  });
});

describe('checkTransaction rule 6', () => {
  const good = () => buildDeposit({ coins: [coin(0, 500_000n)], vaultLockingHex: vault, sats: 400_000n, memo: MEMO, satsPerByte: 1n });

  it('refuses a fourth output', () => {
    const d = good();
    const tx = { ...d.transaction, outputs: [...d.transaction.outputs, { lockingBytecode: userLock, valueSatoshis: 600n }] };
    expect(checkTransaction(tx, d.sourceOutputs, expectation(400_000n))).toMatchObject({ ok: false, rule: 6 });
  });

  it('refuses outputs in another order', () => {
    const d = good();
    const [a, b, c] = d.transaction.outputs;
    const tx = { ...d.transaction, outputs: [b!, a!, c!] };
    expect(checkTransaction(tx, d.sourceOutputs, expectation(400_000n))).toMatchObject({ ok: false, rule: 6 });
  });

  it('refuses a memo other than the one checked', () => {
    const d = good();
    const res = checkTransaction(d.transaction, d.sourceOutputs, expectation(400_000n, { opReturn: opReturnHex('=:BASE.USDC:0xdead:1') }));
    expect(res).toMatchObject({ ok: false, rule: 6 });
  });

  it('refuses a token coin as input', () => {
    const d = good();
    const src = [{ ...d.sourceOutputs[0]!, token: { category: hexToBin(PUSD), amount: 1n } }];
    expect(checkTransaction(d.transaction, src, expectation(400_000n))).toMatchObject({ ok: false, rule: 6 });
  });

  it('without the deposit flag the same transaction is checked by rules 1 to 5 only', () => {
    const d = good();
    expect(checkTransaction(d.transaction, d.sourceOutputs, expectation(400_000n, { thorDeposit: false }))).toEqual({ ok: true });
  });
});
