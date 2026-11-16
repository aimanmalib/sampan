// Sampan Pay, pure parts: the nonce range of the landing contract parameters, invoice pricing and invoice status.
import { binToHex } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { makeCard, readCard } from '../core/landing-card.js';
import { LANDING_NONCE_CEILING, LANDING_RATE_DEN, landingAddress, landingParamsProblem, minTokensFor, type LandingParams } from '../core/landing.js';
import { bip21, invoiceRate, requiredSatsFor, satsToBch, usdToTokens } from '../core/pay/quote.js';
import { invoiceStatus, isSettled } from '../core/pay/status.js';
import { PUSD, userLock } from './helpers/pools.js';

// A landing measured on mainnet (docs/MEASURED.md, plain payment row of 2026-11-15, convert 418fe0c9...): parameters
// read back from the redeem script in that transaction's first input, and the P2SH address that script hashes to.
const MEASURED_LANDING: LandingParams = {
  ownerLockHex: '76a9148b2547714cff505d0bf7349683ea44082880ccc988ac',
  category: PUSD,
  rateNum: 18_000n,
  rateDen: LANDING_RATE_DEN,
  returnAfter: 6,
};
const MEASURED_ADDRESS = 'bitcoincash:ppl6cs0ler8mxnhpppxuanets3u9ycq2tyy0nq7atm';

const params = (rateDen: bigint): LandingParams => ({ ownerLockHex: binToHex(userLock), category: PUSD, rateNum: 48_000n, rateDen, returnAfter: 6 });

describe('landing parameters with an invoice nonce', () => {
  it('leaves a plain landing as it is on mainnet: rateDen 1e8, same address', () => {
    expect(landingParamsProblem(MEASURED_LANDING)).toBeUndefined();
    expect(landingAddress(MEASURED_LANDING, 'bitcoincash')).toBe(MEASURED_ADDRESS);
  });

  it('accepts rateDen 1e8 + 1 to 1e8 + maxNonce only when a maxNonce is given', () => {
    expect(landingParamsProblem(params(LANDING_RATE_DEN + 1n))).toMatch(/rateDen must be 100000000$/);
    expect(landingParamsProblem(params(LANDING_RATE_DEN + 1n), 10)).toBeUndefined();
    expect(landingParamsProblem(params(LANDING_RATE_DEN + 10n), 10)).toBeUndefined();
    expect(landingParamsProblem(params(LANDING_RATE_DEN + 11n), 10)).toMatch(/100000000 to 100000010/);
    expect(landingParamsProblem(params(LANDING_RATE_DEN - 1n), 10)).toMatch(/rateDen/);
    expect(landingParamsProblem(params(LANDING_RATE_DEN + BigInt(LANDING_NONCE_CEILING) + 1n), 10 * LANDING_NONCE_CEILING)).toMatch(/rateDen/);
  });

  it('gives each nonce its own address, and reads an invoice card only with the nonce range', () => {
    const a = landingAddress(params(LANDING_RATE_DEN + 1n), 'bitcoincash');
    const b = landingAddress(params(LANDING_RATE_DEN + 2n), 'bitcoincash');
    expect(a).not.toBe(b);
    const card = makeCard(params(LANDING_RATE_DEN + 7n), { network: 'mainnet', token: 'PUSD', created: new Date(0) });
    expect(readCard(card)).toMatch(/rateDen must be/);
    const read = readCard(card, 100);
    if (typeof read === 'string') throw new Error(read);
    expect(read.params.rateDen).toBe(LANDING_RATE_DEN + 7n);
  });
});

describe('invoice pricing', () => {
  it('turns USD into PUSD units and refuses fractions of a cent and non-numbers', () => {
    expect(usdToTokens(0.2, 2)).toBe(20n);
    expect(usdToTokens(12.34, 2)).toBe(1234n);
    expect(usdToTokens(0.205, 2)).toMatch(/at most 2 decimals/);
    expect(usdToTokens(0, 2)).toMatch(/positive/);
    expect(usdToTokens(Number.NaN, 2)).toMatch(/positive/);
  });

  it('asks for the trade plus the buffer, the convert fee and the token dust', () => {
    expect(requiredSatsFor({ tradeSats: 50_000n, bufferBps: 100, convertFeeSats: 700, tokenDustSats: 1000 })).toBe(50_500n + 1700n);
    expect(requiredSatsFor({ tradeSats: 1n, bufferBps: 100, convertFeeSats: 0, tokenDustSats: 0 })).toBe(2n); // rounded up
  });

  it('sets the contract floor of a payment of requiredSats to exactly the invoice', () => {
    for (const [tokens, required, nonce] of [[20n, 52_207n, 1], [1234n, 3_000_001n, 999_999], [25_000n, 62_500_000n, 4242]] as const) {
      const rate = invoiceRate(tokens, required, nonce);
      expect(rate.rateDen).toBe(LANDING_RATE_DEN + BigInt(nonce));
      expect(minTokensFor(rate, required)).toBe(tokens);
      expect(minTokensFor(rate, required / 2n)).toBeLessThanOrEqual(tokens / 2n + 1n);
    }
  });

  it('writes a BIP21 link with the amount in BCH', () => {
    expect(satsToBch(52_207n)).toBe('0.00052207');
    expect(satsToBch(100_000_000n)).toBe('1');
    expect(satsToBch(150_000_000n)).toBe('1.5');
    expect(bip21('bitcoincash:pq', 52_207n)).toBe('bitcoincash:pq?amount=0.00052207');
  });
});

describe('invoice status', () => {
  const T = { underToleranceBps: 50, overToleranceBps: 100 };
  const inv = (payments: Array<[sats: bigint, seenAt: number]>) => ({
    requiredSats: 10_000n,
    expiresAt: 1000,
    payments: payments.map(([sats, seenAt]) => ({ sats, seenAt })),
  });

  it('is open until expiresAt with nothing paid, then expired', () => {
    expect(invoiceStatus(inv([]), 999, T)).toBe('open');
    expect(invoiceStatus(inv([]), 1000, T)).toBe('expired');
  });

  it('is paid within the tolerances, underpaid below, overpaid above', () => {
    expect(invoiceStatus(inv([[10_000n, 10]]), 20, T)).toBe('paid');
    expect(invoiceStatus(inv([[9_950n, 10]]), 20, T)).toBe('paid');
    expect(invoiceStatus(inv([[9_949n, 10]]), 20, T)).toBe('underpaid');
    expect(invoiceStatus(inv([[10_100n, 10]]), 20, T)).toBe('paid');
    expect(invoiceStatus(inv([[10_101n, 10]]), 20, T)).toBe('overpaid');
  });

  it('adds two payments together, also when the second comes after expiry', () => {
    expect(invoiceStatus(inv([[4_000n, 10], [6_000n, 20]]), 30, T)).toBe('paid');
    expect(invoiceStatus(inv([[4_000n, 10], [6_000n, 2000]]), 3000, T)).toBe('paid');
  });

  it('reports a payment first seen after expiry as paid_late, whatever its size', () => {
    expect(invoiceStatus(inv([[10_000n, 1000]]), 1001, T)).toBe('paid_late');
    expect(invoiceStatus(inv([[1_000n, 5000]]), 6000, T)).toBe('paid_late');
  });

  it('counts a payment below the dust limit as underpaid (it goes back to the merchant as BCH)', () => {
    expect(invoiceStatus(inv([[1_500n, 10]]), 20, T)).toBe('underpaid');
  });

  it('keeps open and early underpaid invoices unsettled', () => {
    expect(isSettled('open', 0, 1000)).toBe(false);
    expect(isSettled('underpaid', 999, 1000)).toBe(false);
    expect(isSettled('underpaid', 1000, 1000)).toBe(true);
    expect(isSettled('paid', 0, 1000)).toBe(true);
  });
});
