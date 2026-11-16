// Who is calling, for rate limits only (never stored). The container is reachable only through the reverse proxy.
// X-Forwarded-For is read only when the socket peer is that proxy (SAMPAN_TRUSTED_PROXY, resolved by name because
// its IP changes when it is recreated); its last entry is the address the proxy saw. cf-connecting-ip is believed
// only when that address is inside Cloudflare's published ranges (config rate.cloudflareCidrs).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const bare = (ip: string): string => (ip.startsWith('::ffff:') ? ip.slice(7) : ip);

const v4 = (ip: string): number | null => {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
};

const v6 = (ip: string): bigint | null => {
  const [head = '', tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  if (!ip.includes('::') && h.length !== 8) return null;
  if (h.length + t.length > 8) return null;
  const parts = [...h, ...Array<string>(8 - h.length - t.length).fill('0'), ...t];
  if (!parts.every((x) => /^[0-9a-f]{1,4}$/i.test(x))) return null;
  return parts.reduce((acc, x) => (acc << 16n) + BigInt(`0x${x}`), 0n);
};

export function inCidr(ipRaw: string, cidr: string): boolean {
  const ip = bare(ipRaw);
  const [net = '', bitsText = ''] = cidr.split('/');
  const bits = Number(bitsText);
  if (isIP(ip) === 4 && isIP(net) === 4) {
    const a = v4(ip);
    const b = v4(net);
    if (a === null || b === null || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  }
  if (isIP(ip) === 6 && isIP(net) === 6) {
    const a = v6(ip);
    const b = v6(net);
    if (a === null || b === null || bits < 0 || bits > 128) return false;
    const shift = BigInt(128 - bits);
    return a >> shift === b >> shift;
  }
  return false;
}

type Headers = Record<string, string | string[] | undefined>;

const header = (headers: Headers, k: string): string => {
  const v = headers[k];
  return (Array.isArray(v) ? v[v.length - 1] : v) ?? '';
};

export interface ClientIpOptions {
  /** Host names or IPs of the reverse proxy. Empty = forwarded headers are never read. */
  trustedProxies: string[];
  cloudflareCidrs: string[];
  resolve?: (name: string) => Promise<string[]>;
  log?: ((message: string) => void) | undefined;
}

export class ClientIp {
  private trusted = new Set<string>();
  private resolvedAt = 0;
  private readonly resolve: (name: string) => Promise<string[]>;

  constructor(private readonly o: ClientIpOptions) {
    this.resolve = o.resolve ?? (async (name) => (await lookup(name, { all: true })).map((r) => r.address));
  }

  /** Re-resolves the proxy names; keeps the old set if every lookup fails. */
  async refresh(): Promise<void> {
    this.resolvedAt = Date.now();
    const next = new Set<string>();
    for (const n of this.o.trustedProxies) {
      if (isIP(n)) next.add(bare(n));
      else
        for (const a of await this.resolve(n).catch(() => [] as string[])) next.add(bare(a));
    }
    if (next.size > 0) this.trusted = next;
    else if (this.o.trustedProxies.length > 0) this.o.log?.('trusted proxy did not resolve; forwarded headers are ignored');
  }

  of(peer: string | undefined, headers: Headers): string {
    const v = this.view(peer, headers);
    if (!v) return bare(peer ?? '') || 'unknown';
    const cf = header(headers, 'cf-connecting-ip').trim();
    if (cf && isIP(cf) && v.cloudflare) return bare(cf);
    return v.seen;
  }

  /** Two-letter country from cf-ipcountry, believed only when the request came through Cloudflare; else null. */
  country(peer: string | undefined, headers: Headers): string | null {
    const v = this.view(peer, headers);
    if (!v?.cloudflare) return null;
    const cc = header(headers, 'cf-ipcountry').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(cc) ? cc : null;
  }

  /** What the trusted proxy saw, or null when the socket peer is not the proxy. */
  private view(peer: string | undefined, headers: Headers): { seen: string; cloudflare: boolean } | null {
    const sock = bare(peer ?? '');
    if (!this.trusted.has(sock)) {
      if (this.o.trustedProxies.length > 0 && Date.now() - this.resolvedAt > 10_000) void this.refresh();
      return null;
    }
    const xff = header(headers, 'x-forwarded-for').split(',').map((s) => s.trim()).filter(Boolean);
    const seen = bare(xff[xff.length - 1] ?? sock);
    return { seen, cloudflare: this.o.cloudflareCidrs.some((c) => inCidr(seen, c)) };
  }
}
