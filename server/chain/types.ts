// What the server needs from the Bitcoin Cash network. One real implementation (Electrum/Fulcrum with failover)
// and one in-memory fake for tests and SAMPAN_FAKE=1. Addresses are passed as locking bytecode hex.
export interface ChainToken {
  category: string;
  amount: bigint;
  /** Present when the output carries an NFT; such coins are never spent by Sampan. */
  nft?: { capability: string; commitment: string };
}

export interface ChainUtxo {
  txid: string;
  vout: number;
  sats: bigint;
  /** 0 or below = unconfirmed (mempool). */
  height: number;
  token?: ChainToken;
}

/** A transaction read back from the network. `height` 0 or below = in the mempool (only filled when asked for). */
export interface ChainTx {
  hex: string;
  height: number;
}

export interface Chain {
  listUnspent(lockingHex: string): Promise<ChainUtxo[]>;
  /** Number of transactions that ever touched this locking bytecode (confirmed and mempool). */
  historyCount(lockingHex: string): Promise<number>;
  /** Returns the txid, or throws BroadcastError with the node's message. */
  broadcast(txHex: string): Promise<string>;
  tipHeight(): Promise<number>;
  /** The transaction as the network has it, or null when the network does not know it. */
  transaction(txid: string, withHeight?: boolean): Promise<ChainTx | null>;
  /**
   * Calls `onChange` whenever the server reports a change at this locking bytecode (a payment seen in the mempool,
   * a confirmation, a spend). Best effort: callers still poll. Returns a function that stops watching.
   */
  watch(lockingHex: string, onChange: () => void): () => void;
  close(): Promise<void>;
}

export class BroadcastError extends Error {
  /** True when the node says an input is already spent or unknown: refresh pools and build again. */
  readonly staleInputs: boolean;
  constructor(message: string) {
    super(message);
    this.staleInputs = /missing ?inputs|missingorspent|txn-mempool-conflict|inputs-spent|bad-txns-inputs/i.test(message);
  }
}

export class ChainUnavailableError extends Error {}
