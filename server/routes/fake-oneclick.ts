// Fake 1Click for SAMPAN_FAKE=1 and tests: answers from a synthetic fixture (tests/fixtures/oneclick/synthetic.json,
// written from the OpenAPI shapes, never a recorded response) with amounts scaled to the request. A real quote gets
// the fixture's deposit address; status by that address reports SUCCESS, any other address 404. No network.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { OneClickHttp, QuoteRequest } from './oneclick-api.js';

interface Fixture {
  rates: { outUnitsPerBch: string; inSatsPerWholeToken: string; withdrawFeeUnits: string; withdrawFeeSats: string };
  depositAddresses: { bch: string; evm: string };
  timeEstimate: { out: number; in: number };
  status: Record<string, unknown>;
}

const PLAIN_BCH = /^(bitcoincash|bchtest):[qp][02-9ac-hj-np-z]{41}$/;

export interface FakeOneClickLog {
  /** Every request as the fake saw it (tests read headers and bodies from here). */
  requests: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }>;
}

/** `bchAsset`: the configured BCH asset id (the direction of a quote follows from it); decimals of the other side from `decimalsOf`. */
export function fakeOneClick(bchAsset: string, decimalsOf: (id: string) => number, file = path.resolve('tests/fixtures/oneclick/synthetic.json'), log?: FakeOneClickLog): OneClickHttp {
  const f = JSON.parse(readFileSync(file, 'utf8')) as Fixture;
  return async (r) => {
    const body = r.body === undefined ? undefined : (JSON.parse(r.body) as unknown);
    log?.requests.push({ method: r.method, url: r.url, headers: r.headers, body });
    const u = new URL(r.url);
    if (r.method === 'POST' && u.pathname === '/v0/quote') {
      const q = body as QuoteRequest;
      // Like the real API: a BCH address must be a plain cash address (q... or p...); a token-aware one is refused.
      const bchSide = q.originAsset === bchAsset ? q.refundTo : q.destinationAsset === bchAsset ? q.recipient : undefined;
      if (bchSide !== undefined && !PLAIN_BCH.test(bchSide)) return { status: 400, body: { message: q.originAsset === bchAsset ? 'refundTo is not valid' : 'recipient is not valid' } };
      const amount = BigInt(q.amount);
      const out = q.originAsset === bchAsset;
      const gross = out
        ? (amount * BigInt(f.rates.outUnitsPerBch)) / 100_000_000n
        : (amount * BigInt(f.rates.inSatsPerWholeToken)) / 10n ** BigInt(decimalsOf(q.originAsset));
      const fee = BigInt(out ? f.rates.withdrawFeeUnits : f.rates.withdrawFeeSats);
      if (gross <= fee) return { status: 400, body: { message: 'Amount is too low for bridge, try at least 1000000' } };
      const amountOut = gross - fee;
      return {
        status: 201,
        body: {
          correlationId: 'synthetic',
          timestamp: new Date(0).toISOString(),
          signature: 'synthetic',
          quoteRequest: q,
          quote: {
            ...(q.dry ? {} : { depositAddress: out ? f.depositAddresses.bch : f.depositAddresses.evm, deadline: q.deadline }),
            amountIn: q.amount,
            amountInFormatted: '',
            amountInUsd: '',
            minAmountIn: q.amount,
            amountOut: amountOut.toString(),
            amountOutFormatted: '',
            amountOutUsd: '',
            minAmountOut: ((amountOut * BigInt(10_000 - q.slippageTolerance)) / 10_000n).toString(),
            timeEstimate: out ? f.timeEstimate.out : f.timeEstimate.in,
            withdrawFee: fee.toString(),
          },
        },
      };
    }
    if (r.method === 'POST' && u.pathname === '/v0/deposit/submit') return { status: 200, body: { status: 'KNOWN_DEPOSIT_TX' } };
    if (r.method === 'GET' && u.pathname === '/v0/status') {
      const a = u.searchParams.get('depositAddress') ?? '';
      if (a !== f.depositAddresses.bch && a !== f.depositAddresses.evm) return { status: 404, body: { message: 'Deposit address not found' } };
      return { status: 200, body: { correlationId: 'synthetic', quoteResponse: {}, ...f.status } };
    }
    return { status: 404, body: { message: 'not found' } };
  };
}
