// One Sampan Pay measurement as a Runs row (KP30) and its note line. Pure: tools/measure/pay.ts gathers the facts.
// A row is ok only when every link of the chain held: the payment was broadcast, the server calls the invoice paid,
// the conversion paid PUSD to the merchant, both transactions are known to Electrum, the PUSD output is at the
// merchant's address, and the webhook receiver checked the signature of an invoice.paid event for this invoice.
import { readFileSync, writeFileSync } from 'node:fs';
import { payTxid, type Run } from './runs.js';

export interface PayInvoiceView {
  id: string;
  status: string;
  convert: Array<{ txid: string; pusd: string }>;
  webhook: { state: string; attempts: number };
}

export interface HookReceipt {
  /** The signature and timestamp passed checkWebhook. */
  verified: boolean;
  type: string;
  invoiceId: string;
  receivedAt: number;
}

export interface PayFacts {
  usd: number;
  how: 'plain' | 'wizard';
  where: 'local' | 'live';
  utc: Date;
  payTxid?: string;
  paidAt?: number;
  view?: PayInvoiceView;
  hook?: HookReceipt;
  /** Both transactions were found on Electrum. */
  onChain: { pay: boolean; convert: boolean };
  /** PUSD units in output 0 of the conversion at the merchant's address; undefined when not found. */
  tokensAtMerchant?: bigint;
}

export const payAmount = (f: Pick<PayFacts, 'usd' | 'how' | 'where'>): string => `${f.usd.toFixed(2)} USD · ${f.how} · ${f.where}`;

/** Why the run is not ok, or null when it is. */
export function payProblem(f: PayFacts): string | null {
  if (!f.payTxid) return 'the payment was not sent';
  if (!f.view) return 'the invoice could not be read';
  if (f.view.status !== 'paid') return `invoice status ${f.view.status}`;
  const convert = f.view.convert[0]?.txid;
  if (!convert) return 'no conversion on the invoice';
  if (!f.onChain.pay) return 'the payment is not on Electrum';
  if (!f.onChain.convert) return 'the conversion is not on Electrum';
  if (f.tokensAtMerchant === undefined || f.tokensAtMerchant <= 0n) return 'no PUSD at the merchant address';
  if (!f.hook) return `no webhook received (state ${f.view.webhook.state})`;
  if (!f.hook.verified) return 'the webhook signature did not check';
  if (f.hook.invoiceId !== f.view.id) return 'the webhook names another invoice';
  if (f.hook.type !== 'invoice.paid') return `webhook event ${f.hook.type}`;
  return null;
}

export function payRun(f: PayFacts): Run {
  const problem = payProblem(f);
  const convert = f.view?.convert[0]?.txid;
  const txid = f.payTxid && convert ? payTxid({ pay: f.payTxid, convert }) : f.payTxid;
  const seconds = f.hook && f.paidAt !== undefined ? (f.hook.receivedAt - f.paidAt) / 1000 : undefined;
  const run: Run = { utc: f.utc, flow: 'pay', amount: payAmount(f), ok: problem === null };
  if (txid) run.txid = txid;
  if (seconds !== undefined && problem === null) run.seconds = seconds;
  if (problem) run.note = problem;
  return run;
}

/** The note under the table: invoice id, final status, webhook delivery. */
export function payNote(f: PayFacts): string {
  const utc = f.utc.toISOString().replace(/:\d\d\.\d{3}Z$/, 'Z').replace('T', ' ');
  if (!f.view) return `- ${utc}: no invoice view (${payProblem(f) ?? 'unknown'}).`;
  const w = f.view.webhook;
  const hook = f.hook ? `${f.hook.type}, signature ${f.hook.verified ? 'checked' : 'refused'} by the receiver` : 'nothing received';
  return `- ${utc} invoice \`${f.view.id}\`: ${f.view.status}, webhook ${w.state} after ${w.attempts} attempt${w.attempts === 1 ? '' : 's'} (${hook}).`;
}

export const PAY_SECTION = '### Sampan Pay runs';

/** Adds a note line at the end of the Sampan Pay section (which must exist), before the next heading. */
export function appendPayNote(file: string, line: string): void {
  const lines = readFileSync(file, 'utf8').split('\n');
  const at = lines.indexOf(PAY_SECTION);
  if (at < 0) throw new Error(`${file} has no "${PAY_SECTION}" section`);
  let end = at + 1;
  while (end < lines.length && !lines[end]!.startsWith('#')) end += 1;
  while (end > at + 1 && lines[end - 1] === '') end -= 1;
  lines.splice(end, 0, line);
  writeFileSync(file, lines.join('\n'));
}
