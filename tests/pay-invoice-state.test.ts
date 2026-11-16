// The invoice status page's words and timers for every status (web/src/pay/invoice-state.ts): an expired address is
// never offered for paying, an underpaid invoice asks for the rest only while time is left, and the page keeps
// asking only while something can still change.
import { describe, expect, it } from 'vitest';
import { countdown, dueSats, keepAsking, payable, statusLine, type InvoiceView } from '../web/src/pay/invoice-state.js';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const view = (patch: Partial<InvoiceView> = {}): InvoiceView => ({
  id: 'a'.repeat(32),
  status: 'open',
  usd: '0.20',
  address: 'bitcoincash:pexample',
  bip21: 'bitcoincash:pexample?amount=0.001',
  requiredSats: '100000',
  paidSats: '0',
  expiresAt: new Date(NOW + 60_000).toISOString(),
  orderId: null,
  returnUrl: null,
  payments: [],
  convert: [],
  ...patch,
});
const past = new Date(NOW - 1).toISOString();
const convert = [{ txid: 'b'.repeat(64), pusd: '0.20' }];

describe('invoice status page', () => {
  it('open: payable, the whole amount due, keeps asking', () => {
    expect(statusLine(view(), NOW).line).toBe('open');
    expect(payable(view(), NOW)).toBe(true);
    expect(dueSats(view())).toBe(100000n);
    expect(keepAsking(view(), NOW, null)).toBe(true);
  });

  it('expired: the address is not offered and the page stops asking', () => {
    const v = view({ status: 'expired', expiresAt: past });
    expect(statusLine(v, NOW).line).toBe('expired');
    expect(payable(v, NOW)).toBe(false);
    expect(keepAsking(v, NOW, null)).toBe(false);
    // An open invoice whose time just ran out is no longer payable either, before the server says expired.
    expect(payable(view({ expiresAt: past }), NOW)).toBe(false);
  });

  it('underpaid asks for the rest while time is left, and says the time is up after', () => {
    const v = view({ status: 'underpaid', paidSats: '40000' });
    expect(statusLine(v, NOW)).toEqual({ line: 'underpaid', vars: { paid: '0.0004', required: '0.001', rest: '0.0006' } });
    expect(dueSats(v)).toBe(60000n);
    expect(payable(v, NOW)).toBe(true);
    const late = { ...v, expiresAt: past };
    expect(statusLine(late, NOW).line).toBe('underpaidLate');
    expect(payable(late, NOW)).toBe(false);
  });

  it('paid says converting until the convert is read, then the PUSD the shop received', () => {
    expect(statusLine(view({ status: 'paid', paidSats: '100000' }), NOW).line).toBe('converting');
    expect(keepAsking(view({ status: 'paid', paidSats: '100000' }), NOW, null)).toBe(true);
    expect(statusLine(view({ status: 'paid', paidSats: '100000', convert }), NOW)).toEqual({ line: 'paid', vars: { pusd: '0.20' } });
    expect(keepAsking(view({ status: 'paid', paidSats: '100000', convert }), NOW, null)).toBe(false);
  });

  it('overpaid and paid_late have their own honest words', () => {
    expect(statusLine(view({ status: 'overpaid', paidSats: '150000', convert }), NOW).line).toBe('overpaid');
    expect(statusLine(view({ status: 'paid_late', paidSats: '100000', convert, expiresAt: past }), NOW).line).toBe('paid_late');
  });

  it('a demo order keeps the page asking until the shop has handed it over', () => {
    const v = view({ status: 'paid', paidSats: '100000', convert, orderId: 'demo-0123456789ab' });
    expect(keepAsking(v, NOW, false)).toBe(true);
    expect(keepAsking(v, NOW, true)).toBe(false);
    expect(keepAsking({ ...v, orderId: 'A-1001' }, NOW, false)).toBe(false);
  });

  it('counts down in minutes and seconds, hours when needed, never below zero', () => {
    expect(countdown(29 * 60_000 + 5_000)).toBe('29:05');
    expect(countdown(3_600_000 + 61_000)).toBe('1:01:01');
    expect(countdown(-5)).toBe('00:00');
    expect(countdown(1)).toBe('00:01');
  });
});
