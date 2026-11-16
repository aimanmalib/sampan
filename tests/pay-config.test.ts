// The pay block of config/sampan.json: shipped off and without a spread, and the checks on every value.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateConfig, type SampanConfig } from '../core/config.js';
import { LANDING_NONCE_CEILING } from '../core/landing.js';

const shipped = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as SampanConfig;
const clone = (): SampanConfig => structuredClone(shipped);

describe('config pay', () => {
  it('ships with Sampan Pay hidden and no spread', () => {
    expect(shipped.features.pay).toBe(false);
    expect(shipped.pay.spreadBps).toBe(0);
    expect(validateConfig(shipped)).toEqual([]);
  });

  it('rejects a nonce range above the contract ceiling and too many open invoices for the range', () => {
    const c = clone();
    c.pay.maxNonce = LANDING_NONCE_CEILING + 1;
    expect(validateConfig(c).join()).toMatch(/pay\.maxNonce/);
    const d = clone();
    d.pay.maxNonce = 1000;
    d.pay.maxOpenInvoices = 11;
    expect(validateConfig(d).join()).toMatch(/pay\.maxOpenInvoices/);
  });

  it('rejects a demo merchant that cannot receive tokens, and a demo price outside the limits', () => {
    const c = clone();
    c.pay.demo.merchantAddress = shipped.ops.testAddresses[0]!; // plain q... address
    c.pay.demo.priceUsd = c.pay.minUsd / 2;
    const errors = validateConfig(c).join('\n');
    expect(errors).toMatch(/pay\.demo\.merchantAddress/);
    expect(errors).toMatch(/pay\.demo\.priceUsd/);
  });

  it('rejects retry waits that shrink, a spread above 500 bps and fractions of a cent', () => {
    const c = clone();
    c.pay.webhook.retrySeconds = [60, 10];
    c.pay.spreadBps = 501;
    c.pay.minUsd = 0.005;
    const errors = validateConfig(c).join('\n');
    expect(errors).toMatch(/retrySeconds/);
    expect(errors).toMatch(/pay\.spreadBps/);
    expect(errors).toMatch(/minUsd/);
  });

  it('rejects a webhook tick slower than the first retry', () => {
    const c = clone();
    c.pay.webhook.tickSeconds = c.pay.webhook.retrySeconds[0]! + 1;
    expect(validateConfig(c).join()).toMatch(/tickSeconds/);
  });

  it('needs rate.invoicesPerHour', () => {
    const c = clone();
    c.rate.invoicesPerHour = 0;
    expect(validateConfig(c).join()).toMatch(/rate/);
  });
});
