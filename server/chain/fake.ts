// In-memory chain for tests and SAMPAN_FAKE=1. Broadcast really spends the inputs and creates the outputs, so a
// swap followed by a rescan shows the new balances. Nothing leaves the machine.
import { binToHex, decodeTransaction, hashTransaction, hexToBin } from '@bitauth/libauth';
import { BroadcastError, type Chain, type ChainUtxo } from './types.js';

export class FakeChain implements Chain {
  private readonly utxos = new Map<string, ChainUtxo[]>();
  private readonly history = new Map<string, number>();
  height = 900_000;

  add(lockingHex: string, utxo: ChainUtxo): void {
    const key = lockingHex.toLowerCase();
    this.utxos.set(key, [...(this.utxos.get(key) ?? []), utxo]);
    this.history.set(key, (this.history.get(key) ?? 0) + 1);
  }

  async listUnspent(lockingHex: string): Promise<ChainUtxo[]> {
    return [...(this.utxos.get(lockingHex.toLowerCase()) ?? [])];
  }

  historyOf(lockingHex: string): number {
    return this.history.get(lockingHex.toLowerCase()) ?? 0;
  }

  async historyCount(lockingHex: string): Promise<number> {
    return this.historyOf(lockingHex);
  }

  async broadcast(txHex: string): Promise<string> {
    const tx = decodeTransaction(hexToBin(txHex));
    if (typeof tx === 'string') throw new BroadcastError(`TX decode failed: ${tx}`);
    const spent: Array<[string, number]> = [];
    for (const input of tx.inputs) {
      const txid = binToHex(input.outpointTransactionHash);
      const found = [...this.utxos.entries()].find(([, list]) => list.some((u) => u.txid === txid && u.vout === input.outpointIndex));
      if (!found) throw new BroadcastError('bad-txns-inputs-missingorspent');
      spent.push([found[0], input.outpointIndex]);
      this.utxos.set(found[0], found[1].filter((u) => !(u.txid === txid && u.vout === input.outpointIndex)));
    }
    const txid = hashTransaction(hexToBin(txHex));
    tx.outputs.forEach((o, vout) => {
      if (o.valueSatoshis === 0n) return;
      this.add(binToHex(o.lockingBytecode), {
        txid,
        vout,
        sats: o.valueSatoshis,
        height: 0,
        ...(o.token ? { token: { category: binToHex(o.token.category), amount: o.token.amount } } : {}),
      });
    });
    for (const [lock] of spent) this.history.set(lock, (this.history.get(lock) ?? 0) + 1);
    return txid;
  }

  async tipHeight(): Promise<number> {
    return this.height;
  }

  async close(): Promise<void> {}
}
