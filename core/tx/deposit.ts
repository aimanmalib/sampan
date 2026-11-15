// A THORChain deposit from a BCH wallet. Pure. Shape required by THORChain and checked by checkTransaction
// rule 6: output 0 pays the vault exactly the quoted amount, output 1 returns change to the address of input 0
// (THORChain treats that address as the sender and refunds there), output 2 is the OP_RETURN memo. No other
// outputs. Inputs are plain P2PKH coins of the user, never token coins. The first coin given is input 0.
import { encodeTransaction, hexToBin, type Output } from '@bitauth/libauth';
import { opReturnHex } from '../routes/memo.js';
import type { Payment, WalletCoin } from './payment.js';
import { BCH_DUST_SATS, P2PKH_UNLOCK_SIZE, type Tx } from './types.js';

export interface DepositParams {
  /** Input 0 first (the proceeds of step 1, or the wallet's largest plain coin); more are added in order. */
  coins: WalletCoin[];
  vaultLockingHex: string;
  sats: bigint;
  memo: string;
  /** At least the quote's recommended gas rate. */
  satsPerByte: bigint;
}

export class DepositBuildError extends Error {}

const P2PKH = /^76a914[0-9a-f]{40}88ac$/;

export function buildDeposit(p: DepositParams): Payment {
  if (p.coins.length === 0) throw new DepositBuildError('no coins to spend');
  if (p.sats < BCH_DUST_SATS) throw new DepositBuildError('deposit is below the dust limit');
  for (const c of p.coins) {
    if (c.hasToken) throw new DepositBuildError('a deposit never spends token coins');
    if (!P2PKH.test(c.lockingHex)) throw new DepositBuildError('a deposit spends plain P2PKH coins only');
  }
  const memoLock = hexToBin(opReturnHex(p.memo));
  const changeLock = hexToBin(p.coins[0]!.lockingHex);
  const picked: WalletCoin[] = [];
  let total = 0n;
  const make = (change: bigint, unlockSize: number): Tx => ({
    version: 2,
    locktime: 0,
    inputs: picked.map((c) => ({
      outpointTransactionHash: hexToBin(c.txid),
      outpointIndex: c.vout,
      sequenceNumber: 0xffffffff,
      unlockingBytecode: new Uint8Array(unlockSize),
    })),
    outputs: [
      { lockingBytecode: hexToBin(p.vaultLockingHex), valueSatoshis: p.sats },
      { lockingBytecode: changeLock, valueSatoshis: change },
      { lockingBytecode: memoLock, valueSatoshis: 0n },
    ],
  });
  for (const coin of p.coins) {
    picked.push(coin);
    total += coin.sats;
    const fee = BigInt(encodeTransaction(make(1n, P2PKH_UNLOCK_SIZE)).length) * p.satsPerByte;
    const change = total - p.sats - fee;
    // THORChain wants the change output present, so it must be spendable on its own.
    if (change < BCH_DUST_SATS) continue;
    const tx = make(change, 0);
    const sourceOutputs: Output[] = picked.map((c) => ({ lockingBytecode: hexToBin(c.lockingHex), valueSatoshis: c.sats }));
    return { transaction: tx, sourceOutputs, inputPaths: picked.map((c, inputIndex) => ({ inputIndex, path: c.path })), feeSats: fee };
  }
  throw new DepositBuildError('not enough plain BCH for this deposit, its fee and the change output');
}

/** Bytes of a deposit with `inputs` coins and this memo, after signing (for fee estimates before a build). */
export function depositSize(inputs: number, memo: string): number {
  const coin = { txid: '00'.repeat(32), vout: 0, sats: 0n, lockingHex: `76a914${'00'.repeat(20)}88ac`, path: 'receive/0', hasToken: false };
  const tx: Tx = {
    version: 2,
    locktime: 0,
    inputs: Array.from({ length: inputs }, () => ({
      outpointTransactionHash: hexToBin(coin.txid),
      outpointIndex: 0,
      sequenceNumber: 0xffffffff,
      unlockingBytecode: new Uint8Array(P2PKH_UNLOCK_SIZE),
    })),
    outputs: [
      { lockingBytecode: hexToBin(coin.lockingHex), valueSatoshis: 1n },
      { lockingBytecode: hexToBin(coin.lockingHex), valueSatoshis: 1n },
      { lockingBytecode: hexToBin(opReturnHex(memo)), valueSatoshis: 0n },
    ],
  };
  return encodeTransaction(tx).length;
}
