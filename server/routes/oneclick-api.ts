// NEAR Intents 1Click API client: the three documented endpoints Sampan calls (POST /v0/quote, POST /v0/deposit/submit,
// GET /v0/status; asset ids come from config, read once from GET /v0/tokens in ADR 0048), with types written from the
// official OpenAPI. Server only. The API key
// travels in the X-API-Key header and nowhere else: never in a URL, an error message or a log line. Dry quotes are kept
// in memory for oneClick.cacheSeconds (at most 24 hours, terms 4.1(e)); real quotes and statuses are never kept.

export interface OneClickHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}
export type OneClickHttp = (r: OneClickHttpRequest) => Promise<{ status: number; body: unknown }>;

export const oneClickFetch: OneClickHttp = async (r) => {
  const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body ?? null, signal: AbortSignal.timeout(r.timeoutMs) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/** QuoteRequest of the OpenAPI, as far as Sampan fills it (no appFees: Sampan's own fee is 0). */
export interface QuoteRequest {
  dry: boolean;
  swapType: 'EXACT_INPUT';
  slippageTolerance: number;
  originAsset: string;
  depositType: 'ORIGIN_CHAIN';
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: 'ORIGIN_CHAIN';
  recipient: string;
  recipientType: 'DESTINATION_CHAIN';
  /** ISO 8601. */
  deadline: string;
}

/** Quote of the OpenAPI: amounts are strings in the smallest unit of each asset. */
export interface QuoteBody {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInUsd?: string;
  minAmountIn?: string;
  amountOut: string;
  amountOutUsd?: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate: number;
  refundFee?: string;
  withdrawFee?: string;
}

export interface QuoteResponse {
  correlationId?: string;
  quote: QuoteBody;
}

export type ExecutionStatus = 'KNOWN_DEPOSIT_TX' | 'PENDING_DEPOSIT' | 'INCOMPLETE_DEPOSIT' | 'PROCESSING' | 'SUCCESS' | 'REFUNDED' | 'FAILED';

export interface StatusResponse {
  status: ExecutionStatus;
  swapDetails?: {
    originChainTxHashes?: Array<{ hash: string }>;
    destinationChainTxHashes?: Array<{ hash: string }>;
    refundedAmount?: string;
  };
}

export class OneClickError extends Error {
  constructor(
    message: string,
    /** True when the API did not answer (as opposed to refusing the request). */
    readonly unreachable: boolean,
  ) {
    super(message);
  }
}

export interface OneClickApiOptions {
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
  cacheSeconds: number;
  /** ONECLICK_JWT from the server env; without it the API still answers and adds its own 0.25 %. */
  apiKey?: string | undefined;
  http?: OneClickHttp;
  now?: () => number;
}

export class OneClickApi {
  private readonly cache = new Map<string, { at: number; value: QuoteResponse }>();
  constructor(private readonly o: OneClickApiOptions) {}

  private headers(json: boolean): Record<string, string> {
    return {
      accept: 'application/json',
      'user-agent': this.o.userAgent,
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...(this.o.apiKey ? { 'x-api-key': this.o.apiKey } : {}),
    };
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.o.baseUrl.replace(/\/$/, '')}${path}`;
    let res: Awaited<ReturnType<OneClickHttp>>;
    try {
      res = await (this.o.http ?? oneClickFetch)({
        method,
        url,
        headers: this.headers(body !== undefined),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        timeoutMs: this.o.timeoutMs,
      });
    } catch {
      throw new OneClickError('1Click is not answering', true);
    }
    if (res.status >= 200 && res.status < 300 && res.body !== null) return res.body as T;
    if (res.status === 401 || res.status === 403) throw new OneClickError(`1Click refused the request (${res.status})`, true);
    const message = (res.body as { message?: unknown } | null)?.message;
    if (res.status >= 400 && res.status < 500 && typeof message === 'string') throw new OneClickError(message.slice(0, 200), false);
    throw new OneClickError(`1Click answered ${res.status}`, true);
  }

  /** A quote. A dry one is answered from memory while it is younger than cacheSeconds; a real one always asks. */
  async quote(r: QuoteRequest): Promise<QuoteResponse> {
    const now = (this.o.now ?? Date.now)();
    // The deadline moves with the clock; two dry quotes for the same request otherwise share an answer.
    const key = r.dry ? JSON.stringify({ ...r, deadline: '' }) : '';
    if (key) {
      const hit = this.cache.get(key);
      if (hit && now - hit.at < this.o.cacheSeconds * 1000) return hit.value;
      for (const [k, v] of this.cache) if (now - v.at >= this.o.cacheSeconds * 1000) this.cache.delete(k);
    }
    const value = await this.call<QuoteResponse>('POST', '/v0/quote', r);
    if (!value?.quote || typeof value.quote.amountOut !== 'string') throw new OneClickError('1Click sent no quote', true);
    if (key && this.o.cacheSeconds > 0) this.cache.set(key, { at: now, value });
    return value;
  }

  /** Tells 1Click a deposit was sent (optional in the API; it speeds up the swap). */
  submit(txHash: string, depositAddress: string): Promise<unknown> {
    return this.call('POST', '/v0/deposit/submit', { txHash, depositAddress });
  }

  status(depositAddress: string): Promise<StatusResponse> {
    return this.call<StatusResponse>('GET', `/v0/status?${new URLSearchParams({ depositAddress }).toString()}`);
  }
}
