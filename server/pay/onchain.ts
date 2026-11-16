// Before a webhook tells a merchant an invoice is settled, the server reads every finishing transaction back from
// the network instead of trusting its own database: the transaction must exist, spend the payment coin and pay
// the merchant's locking bytecode (PUSD of the token category for a convert, BCH for a giveBack). A payment still
// waiting at the invoice address must be there. A row forged into the database therefore sends nothing.
import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import type { Chain } from '../chain/types.js';
import type { InvoiceRow, StoredPayment } from './store.js';

export interface OnchainRules {
  category: string;
  /** Confirmations a finishing transaction needs (0 = seen in the mempool). */
  confirmations: number;
  /** Lock of the invoice address (where waiting payments sit). */
  invoiceLock: string;
  /** The status does not need every payment converted (underpaid: PUSD only for what can be converted). */
  waitingIsFinal: boolean;
}

/** 'ok', 'wait' (not finished yet, try again soon) or the reason the database does not match the network. */
export type OnchainVerdict = 'ok' | 'wait' | string;

async function checkFinish(chain: Chain, row: InvoiceRow, p: StoredPayment, r: OnchainRules): Promise<OnchainVerdict> {
  const txid = p.finishTxid!;
  const got = await chain.transaction(txid, r.confirmations > 0);
  if (!got) return `${txid} is not on the network`;
  if (r.confirmations > 0) {
    if (got.height <= 0) return 'wait';
    if ((await chain.tipHeight()) - got.height + 1 < r.confirmations) return 'wait';
  }
  const tx = decodeTransaction(hexToBin(got.hex));
  if (typeof tx === 'string') return `${txid} does not decode: ${tx}`;
  const [coinTxid, coinVout] = p.coin.split(':');
  if (!tx.inputs.some((i) => binToHex(i.outpointTransactionHash) === coinTxid && i.outpointIndex === Number(coinVout)))
    return `${txid} does not spend the payment ${p.coin}`;
  const toMerchant = tx.outputs.filter((o) => binToHex(o.lockingBytecode) === row.merchant_lock);
  if (p.action === 'converted') {
    const tokens = toMerchant.reduce((s, o) => s + (o.token && binToHex(o.token.category) === r.category ? o.token.amount : 0n), 0n);
    if (tokens <= 0n || tokens < BigInt(p.tokens ?? '0')) return `${txid} pays the merchant ${tokens} token units, not ${p.tokens ?? '0'}`;
    return 'ok';
  }
  const sats = toMerchant.reduce((s, o) => s + o.valueSatoshis, 0n);
  return sats > 0n ? 'ok' : `${txid} pays the merchant nothing`;
}

export async function verifyOnchain(chain: Chain, row: InvoiceRow, payments: StoredPayment[], r: OnchainRules): Promise<OnchainVerdict> {
  let unspent: Set<string> | undefined;
  for (const p of payments) {
    let v: OnchainVerdict;
    if (p.finishTxid) v = await checkFinish(chain, row, p, r);
    else if (!r.waitingIsFinal) v = 'wait';
    else {
      unspent ??= new Set((await chain.listUnspent(r.invoiceLock)).map((u) => `${u.txid}:${u.vout}`));
      v = unspent.has(p.coin) ? 'ok' : `payment ${p.coin} is not at the invoice address`;
    }
    if (v !== 'ok') return v;
  }
  return 'ok';
}
