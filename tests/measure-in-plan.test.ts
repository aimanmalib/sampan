import { describe, expect, it } from 'vitest';
import { convertedTxid, inLabel } from '../tools/measure/in-plan.js';

const PAY = 'aa'.repeat(32);
const CONV = 'BB'.repeat(32);

describe('measured Bring in', () => {
  it('labels the row with the amount, the asset and what arrives', () => {
    const p = { amount: 200_000_000n, symbol: 'USDC', chain: 'ETH', receive: 'PUSD', landing: true };
    expect(inLabel(p, 820_000n)).toBe('2 ETH.USDC to PUSD (landing address, at least 0.0082 BCH arriving)');
    expect(inLabel({ ...p, receive: 'BCH', landing: false }, 820_000n)).toBe('2 ETH.USDC to BCH (at least 0.0082 BCH)');
  });

  it('takes the conversion only once the finisher converted the payment the route made', () => {
    const view = { status: 'converted', txid: CONV, landing: { address: 'bitcoincash:p…', paymentTxid: PAY } };
    expect(convertedTxid(view, PAY.toUpperCase())).toBe(CONV.toLowerCase());
    expect(convertedTxid({ ...view, status: 'watching' }, PAY)).toBeUndefined();
    expect(convertedTxid({ ...view, status: 'returned' }, PAY)).toBeUndefined();
    expect(convertedTxid({ ...view, landing: { address: null, paymentTxid: 'cc'.repeat(32) } }, PAY)).toBeUndefined();
    expect(convertedTxid({ ...view, txid: null }, PAY)).toBeUndefined();
  });
});
