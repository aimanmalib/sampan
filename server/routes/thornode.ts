// THORNode HTTP client: documented public endpoints only, nodes from config tried in order. A node that fails
// or times out hands the request to the next one; a 4xx answer with a THORChain error is final.
export type HttpGet = (url: string, timeoutMs: number) => Promise<{ status: number; body: unknown }>;

export const httpGet: HttpGet = async (url, timeoutMs) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  return { status: res.status, body: await res.json().catch(() => null) };
};

export class ThornodeError extends Error {
  constructor(
    message: string,
    /** True when every node failed to answer (as opposed to THORChain refusing the request). */
    readonly unreachable: boolean,
  ) {
    super(message);
  }
}

export class Thornode {
  constructor(
    private readonly nodes: string[],
    private readonly get: HttpGet = httpGet,
    private readonly timeoutMs = 8000,
  ) {
    if (nodes.length === 0) throw new Error('no THORNode configured');
  }

  async request<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(query).toString();
    let last = 'no node answered';
    for (const node of this.nodes) {
      const url = `${node.replace(/\/$/, '')}${path}${qs ? `?${qs}` : ''}`;
      let res: Awaited<ReturnType<HttpGet>>;
      try {
        res = await this.get(url, this.timeoutMs);
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
        continue;
      }
      if (res.status >= 200 && res.status < 300 && res.body !== null) return res.body as T;
      const message = (res.body as { message?: string; error?: string } | null)?.message ?? (res.body as { error?: string } | null)?.error;
      if (res.status >= 400 && res.status < 500 && message) throw new ThornodeError(message, false);
      last = `node answered ${res.status}`;
    }
    throw new ThornodeError(last, true);
  }
}
