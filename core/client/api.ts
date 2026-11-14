// The page's view of the server API: one POST/GET helper with typed failures. The fetch function is passed in.
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

export type Fetch = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface Api {
  post<T>(path: string, body: unknown): Promise<T>;
  get<T>(path: string): Promise<T>;
}

export function makeApi(fetchFn: Fetch): Api {
  const call = async <T>(path: string, init: Parameters<Fetch>[1]): Promise<T> => {
    let res: Awaited<ReturnType<Fetch>>;
    try {
      res = await fetchFn(path, init);
    } catch {
      throw new ApiFailure(0, 'offline', 'the server could not be reached');
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) throw new ApiFailure(res.status, body.error ?? 'error', body.message ?? `request failed (${res.status})`);
    return body as T;
  };
  return {
    post: (path, body) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    get: (path) => call(path, { method: 'GET', headers: { accept: 'application/json' } }),
  };
}
