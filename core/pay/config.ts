// The pay block of config/sampan.json: Sampan Pay invoices (one landing address per invoice, the contract unchanged).
// Pure. Every limit, tolerance and timer of an invoice lives here; the code only reads it.
import { parseAddress } from '../address.js';
import { prefixOf } from '../business.js';
import { LANDING_NONCE_CEILING } from '../landing.js';

export interface PayConfig {
  /** An invoice is open this long; a payment after that is `paid_late`. */
  validMinutes: number;
  /** A total this far below requiredSats still counts as paid; further below is `underpaid`. */
  underToleranceBps: number;
  /** A total this far above requiredSats still counts as paid; further above is `overpaid`. */
  overToleranceBps: number;
  minUsd: number;
  maxUsd: number;
  /** rateDen of an invoice address is 100000000 + a random nonce from 1 to this (at most LANDING_NONCE_CEILING). */
  maxNonce: number;
  /** Open invoices one merchant may have at a time. */
  maxOpenInvoices: number;
  /** requiredSats covers the trade at the quote plus this margin for the pools moving before the payment. */
  quoteBufferBps: number;
  /** Confirmations of the convert transaction before a webhook is sent (0 = seen in the mempool). */
  confirmations: number;
  /** Sampan's spread on an invoice, in basis points (0 on the public site). */
  spreadBps: number;
  /** Spread used by the scenario table (arithmetic, not a forecast). */
  scenarioSpreadBps: number;
  webhook: {
    /** Wait before each retry; the number of entries is the number of retries. */
    retrySeconds: number[];
    timeoutMs: number;
    /** Allow webhooks to private and loopback addresses (local measurement only, never on the public site). */
    allowPrivate: boolean;
  };
  /** The demo shop on /pay: one product at `priceUsd`, paid to a token address of the project's test wallet. */
  demo: { priceUsd: number; merchantAddress: string };
}

const posInt = (v: number): boolean => Number.isInteger(v) && v > 0;
const bpsIn = (v: number, max: number): boolean => Number.isInteger(v) && v >= 0 && v <= max;
const cents = (v: number): boolean => Number.isFinite(v) && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

export function validatePay(p: PayConfig | undefined): string[] {
  if (!p) return ['pay: missing'];
  const errors: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) errors.push(message);
  };
  need(posInt(p.validMinutes), 'pay.validMinutes: positive integer');
  need(bpsIn(p.underToleranceBps, 2000) && bpsIn(p.overToleranceBps, 2000), 'pay.underToleranceBps, overToleranceBps: integers from 0 to 2000');
  need(bpsIn(p.quoteBufferBps, 2000), 'pay.quoteBufferBps: integer from 0 to 2000');
  need(p.minUsd > 0 && p.maxUsd > p.minUsd && cents(p.minUsd) && cents(p.maxUsd), 'pay: 0 < minUsd < maxUsd, whole cents');
  need(posInt(p.maxNonce) && p.maxNonce <= LANDING_NONCE_CEILING, `pay.maxNonce: integer from 1 to ${LANDING_NONCE_CEILING}`);
  // Nonces are drawn at random: a space far larger than the open invoices keeps redraws rare.
  need(posInt(p.maxOpenInvoices) && p.maxOpenInvoices * 100 <= p.maxNonce, 'pay.maxOpenInvoices: positive integer, at most maxNonce / 100');
  need(Number.isInteger(p.confirmations) && p.confirmations >= 0 && p.confirmations <= 6, 'pay.confirmations: integer from 0 to 6');
  need(bpsIn(p.spreadBps, 500), 'pay.spreadBps: integer from 0 to 500');
  need(Number.isInteger(p.scenarioSpreadBps) && p.scenarioSpreadBps >= 1 && p.scenarioSpreadBps <= 500, 'pay.scenarioSpreadBps: integer from 1 to 500');
  const w = p.webhook;
  need(
    Array.isArray(w?.retrySeconds) && w.retrySeconds.length > 0 && w.retrySeconds.every(posInt) && w.retrySeconds.every((s, i) => i === 0 || s >= w.retrySeconds[i - 1]!),
    'pay.webhook.retrySeconds: positive integers, not decreasing',
  );
  need(posInt(w?.timeoutMs) && w.timeoutMs <= 30_000, 'pay.webhook.timeoutMs: integer from 1 to 30000');
  need(typeof w?.allowPrivate === 'boolean', 'pay.webhook.allowPrivate: boolean');
  need(cents(p.demo?.priceUsd) && p.demo.priceUsd >= p.minUsd && p.demo.priceUsd <= p.maxUsd, 'pay.demo.priceUsd: whole cents from minUsd to maxUsd');
  const merchant = parseAddress(p.demo?.merchantAddress ?? '', prefixOf(p.demo?.merchantAddress ?? ''));
  need(typeof merchant !== 'string' && merchant.tokenAware, 'pay.demo.merchantAddress: a token-aware cash address');
  return errors;
}
