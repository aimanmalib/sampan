import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendPayNote, payNote, payRun, PAY_SECTION, type PayFacts } from '../tools/measure/pay-run.js';
import { countOk, runRow } from '../tools/measure/runs.js';

const PAY = 'aa'.repeat(32);
const CONVERT = 'bb'.repeat(32);
const ID = 'c'.repeat(32);
const paidAt = Date.parse('2026-11-16T19:00:00Z');

const good = (): PayFacts => ({
  usd: 0.2,
  how: 'plain',
  where: 'local',
  utc: new Date('2026-11-16T18:59:58.500Z'),
  payTxid: PAY,
  paidAt,
  view: { id: ID, status: 'paid', convert: [{ txid: CONVERT, pusd: '0.20' }], webhook: { state: 'delivered', attempts: 1 } },
  hook: { verified: true, type: 'invoice.paid', invoiceId: ID, receivedAt: paidAt + 4200 },
  onChain: { pay: true, convert: true },
  tokensAtMerchant: 20n,
});

// The gate's count of `pay … ok` rows (KP30): an ok row whose txid cell holds two full transaction ids.
const gateCount = (row: string): number => {
  const c = row.replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
  return c[1] === 'pay' && c[c.length - 1] === 'ok' && (c[3]!.match(/(?<![0-9a-fA-Fx])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g) ?? []).length >= 2 ? 1 : 0;
};

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('Sampan Pay measured row', () => {
  it('writes an ok row in the KP30 shape the gate counts', () => {
    const row = runRow(payRun(good()));
    expect(row).toBe(`| 2026-11-16T18:59:58Z | pay | 0.20 USD · plain · local | bch ${PAY} · convert ${CONVERT} | 4.2 | ok |`);
    expect(gateCount(row)).toBe(1);
    expect(countOk(row, 'pay')).toBe(1);
  });

  it.each([
    ['no webhook', { hook: undefined }, /no webhook received \(state delivered\)/],
    ['a webhook whose signature failed', { hook: { ...good().hook!, verified: false } }, /signature did not check/],
    ['a webhook for another invoice', { hook: { ...good().hook!, invoiceId: 'd'.repeat(32) } }, /another invoice/],
    ['an underpaid event', { hook: { ...good().hook!, type: 'invoice.underpaid' } }, /webhook event invoice.underpaid/],
    ['an underpaid invoice', { view: { ...good().view!, status: 'underpaid' } }, /invoice status underpaid/],
    ['no conversion', { view: { ...good().view!, convert: [] } }, /no conversion/],
    ['a conversion missing from Electrum', { onChain: { pay: true, convert: false } }, /conversion is not on Electrum/],
    ['a payment missing from Electrum', { onChain: { pay: false, convert: true } }, /payment is not on Electrum/],
    ['no PUSD at the merchant', { tokensAtMerchant: undefined }, /no PUSD/],
    ['a hook seen while the server still retries', { view: { ...good().view!, webhook: { state: 'retrying', attempts: 2 } } }, /webhook state retrying/],
  ])('is not ok with %s', (_name, change, reason) => {
    const facts = { ...good(), ...change } as PayFacts;
    for (const k of Object.keys(change) as Array<keyof PayFacts>) if (facts[k] === undefined) delete facts[k];
    const run = payRun(facts);
    expect(run.ok).toBe(false);
    expect(run.note).toMatch(reason);
    expect(run.seconds).toBeUndefined();
    expect(gateCount(runRow(run))).toBe(0);
  });

  it('writes a live row whose hook is the site demo shop', () => {
    const live: PayFacts = { ...good(), where: 'live' };
    const row = runRow(payRun(live));
    expect(row).toContain('| 0.20 USD · plain · live |');
    expect(gateCount(row)).toBe(1);
    expect(payNote(live)).toContain("signature checked by the site's demo shop, which then handed the order over");
  });

  it('records an unsent payment without a transaction id', () => {
    const unsent = good();
    delete unsent.payTxid;
    delete unsent.paidAt;
    delete unsent.hook;
    const run = payRun(unsent);
    expect(runRow(run)).toBe('| 2026-11-16T18:59:58Z | pay | 0.20 USD · plain · local | - | - | fail (the payment was not sent) |');
  });

  it('keeps the payment id alone when there is no conversion', () => {
    expect(payRun({ ...good(), view: { ...good().view!, convert: [] } }).txid).toBe(PAY);
  });

  it('notes the invoice id and the webhook delivery under the table', () => {
    expect(payNote(good())).toBe(`- 2026-11-16 18:59Z invoice \`${ID}\`: paid, webhook delivered after 1 attempt (invoice.paid, signature checked by the receiver).`);
    const md = ['# Measured', '', PAY_SECTION, '', 'Text.', '', '- first', '', '### Notes on failed runs', ''].join('\n');
    dir = mkdtempSync(path.join(tmpdir(), 'sampan-pay-note-'));
    const file = path.join(dir, 'MEASURED.md');
    writeFileSync(file, md);
    appendPayNote(file, '- second');
    expect(readFileSync(file, 'utf8')).toBe(md.replace('- first\n', '- first\n- second\n'));
  });

  it('refuses a file without the section', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sampan-pay-note-'));
    const file = path.join(dir, 'MEASURED.md');
    writeFileSync(file, '# Measured\n');
    expect(() => appendPayNote(file, '- x')).toThrow(/no "### Sampan Pay runs" section/);
  });
});
