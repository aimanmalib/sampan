// A plain BCH payment from the test wallet's coins: largest coins first, tokens never touched, change back to the
// wallet. Pure; the caller signs and sends.
import { encodeTransaction, hexToBin, type Output } from '@bitauth/libauth';
import { BCH_DUST_SATS, P2PKH_UNLOCK_SIZE, type Tx } from '../../core/tx/types.js';

export interface WalletCoin {
  txid: string;
  vout: number;
  sats: bigint;
  lockingHex: string;
  /** Wallet path, e.g. "receive/3". */
  path: string;
  hasToken: boolean;
}

export interface Payment {
  transaction: Tx;
  sourceOutputs: Output[];
  inputPaths: Array<{ inputIndex: number; path: string }>;
  feeSats: bigint;
}

export function buildPayment(o: { coins: WalletCoin[]; toLockingHex: string; sats: bigint; changeLockingHex: string; satsPerByte: bigint }): Payment {
  if (o.sats < BCH_DUST_SATS) throw new Error(`amount is below ${BCH_DUST_SATS} sats`);
  const plain = o.coins.filter((c) => !c.hasToken).sort((a, b) => (a.sats === b.sats ? 0 : a.sats > b.sats ? -1 : 1));
  const picked: WalletCoin[] = [];
  let total = 0n;
  const make = (change: bigint): Tx => ({
    version: 2,
    locktime: 0,
    inputs: picked.map((c) => ({ outpointTransactionHash: hexToBin(c.txid), outpointIndex: c.vout, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array(P2PKH_UNLOCK_SIZE) })),
    outputs: [
      { lockingBytecode: hexToBin(o.toLockingHex), valueSatoshis: o.sats },
      ...(change > 0n ? [{ lockingBytecode: hexToBin(o.changeLockingHex), valueSatoshis: change }] : []),
    ],
  });
  for (const coin of plain) {
    picked.push(coin);
    total += coin.sats;
    const feeWithChange = BigInt(encodeTransaction(make(1n)).length) * o.satsPerByte;
    const change = total - o.sats - feeWithChange;
    if (change >= 0n) {
      const keep = change >= BCH_DUST_SATS ? change : 0n;
      const tx = make(keep);
      return {
        transaction: { ...tx, inputs: tx.inputs.map((i) => ({ ...i, unlockingBytecode: new Uint8Array() })) },
        sourceOutputs: picked.map((c) => ({ lockingBytecode: hexToBin(c.lockingHex), valueSatoshis: c.sats })),
        inputPaths: picked.map((c, inputIndex) => ({ inputIndex, path: c.path })),
        feeSats: total - o.sats - keep,
      };
    }
  }
  throw new Error('not enough plain BCH in the test wallet');
}
