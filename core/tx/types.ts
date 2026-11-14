// Transaction shapes shared by the builders, the VM check and checkTransaction. Pure.
import type { Input, Output, TransactionCommon } from '@bitauth/libauth';

export type Tx = TransactionCommon<Input, Output>;

/** A wallet coin the user is spending (P2PKH, possibly carrying fungible tokens). */
export interface UserCoin {
  txid: string;
  vout: number;
  sats: bigint;
  lockingBytecode: Uint8Array;
  token?: { category: string; amount: bigint };
}

/** What a builder returns: the unsigned transaction plus everything a wallet needs to sign it. */
export interface BuiltTx {
  transaction: Tx;
  sourceOutputs: Output[];
  /** Indexes of inputs the wallet must sign (user coins). */
  userInputIndexes: number[];
  feeSats: bigint;
  sizeBytes: number;
}

/** Unlocking placeholder used only to measure size: push(65-byte Schnorr sig) + push(33-byte key). */
export const P2PKH_UNLOCK_SIZE = 100;

/** Below this a plain BCH output is non-standard; the value is folded into the fee instead. */
export const BCH_DUST_SATS = 546n;
