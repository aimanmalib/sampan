// NIP-05: a name like alice@example.com points to a Nostr key through https://example.com/.well-known/nostr.json.
// The domain is only asked which key the name stands for; nothing it says is trusted beyond that, because the key's
// binding event is then checked by its signatures (core/nostr-id). The "relays" field of the answer is ignored.
import { isHexPubkey } from '../nostr-id/nip19.js';

export interface Nip05Name {
  /** Local part, lower case (a-z, 0-9, "-", "_", "."). */
  name: string;
  /** Domain, lower case. */
  domain: string;
}

const NAME = /^[a-z0-9._-]+$/;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** name@domain (case-insensitive, trimmed) or null. A bare IP address or a single-label host is not a NIP-05 domain. */
export function parseNip05(input: string): Nip05Name | null {
  const value = input.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0) return null;
  const name = value.slice(0, at);
  const domain = value.slice(at + 1);
  return NAME.test(name) && DOMAIN.test(domain) ? { name, domain } : null;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>>;

export interface Nip05Options {
  timeoutMs: number;
  /** Defaults to the browser's fetch. */
  fetch?: FetchLike;
}

/** The hex key the domain names for this name, or null on any failure (network, redirect, timeout, shape). */
export async function lookupNip05(id: Nip05Name, options: Nip05Options): Promise<string | null> {
  const url = new URL('/.well-known/nostr.json', `https://${id.domain}`);
  url.searchParams.set('name', id.name);
  const doFetch: FetchLike = options.fetch ?? ((u, init) => fetch(u, init));
  try {
    const response = await doFetch(url.href, {
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { names?: Record<string, unknown> } | null;
    const names = body && typeof body === 'object' ? body.names : undefined;
    if (!names || typeof names !== 'object' || !Object.prototype.hasOwnProperty.call(names, id.name)) return null;
    const key = names[id.name];
    return typeof key === 'string' && isHexPubkey(key) ? key : null;
  } catch {
    return null;
  }
}
