// Where a webhook may go. A merchant names any URL, so the server must not be talked into calling itself, the
// host's private network or a cloud metadata address. The URL must be https; every address its name resolves to
// must be public; and the request then connects to the address that was checked (no second DNS lookup between
// the check and the connection). Checked when the invoice is made and again before every delivery.
import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

/** Resolves a host name to every address it has. */
export type Lookup = (host: string) => Promise<string[]>;

export const systemLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

// Two lists: one BlockList matches IPv4 addresses against IPv4-mapped IPv6 rules too, which would block all of IPv4.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
] as const)
  blocked4.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::ffff:0:0', 96], // IPv4-mapped: would reach any IPv4 address, private ones included
  ['64:ff9b::', 96], // NAT64: same
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const)
  blocked6.addSubnet(net, bits, 'ipv6');

/** True for an address a webhook must never reach (loopback, private, link-local, metadata, multicast, reserved). */
export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked4.check(ip, 'ipv4');
  if (family === 6) return blocked6.check(ip, 'ipv6');
  return true; // not an address at all: never connect to it
}

export interface WebhookTarget {
  url: URL;
  /** The checked address the request connects to. */
  ip: string;
}

/** The checked target, or the reason it is refused. */
export async function webhookTarget(raw: string, o: { allowPrivate: boolean; lookup: Lookup }): Promise<WebhookTarget | string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'webhookUrl is not a URL';
  }
  if (url.protocol !== 'https:') return 'webhookUrl must be an https URL';
  if (url.username || url.password) return 'webhookUrl must not carry a user name or password';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let ips: string[];
  if (isIP(host)) ips = [host];
  else {
    try {
      ips = await o.lookup(host);
    } catch {
      return `webhookUrl host ${host} does not resolve`;
    }
  }
  if (ips.length === 0) return `webhookUrl host ${host} does not resolve`;
  if (!o.allowPrivate && ips.some(isPrivateIp)) return `webhookUrl host ${host} is a private, loopback or reserved address`;
  return { url, ip: ips[0]! };
}

/** Sends one POST; resolves with the HTTP status. Rejects on a network error or after `timeoutMs`. */
export type Transport = (target: WebhookTarget, headers: Record<string, string>, body: string, timeoutMs: number) => Promise<number>;

/** HTTPS POST to the checked address; TLS still verifies the certificate for the URL's host name. No redirects. */
export const httpsTransport: Transport = (target, headers, body, timeoutMs) =>
  new Promise((resolve, reject) => {
    const family = isIP(target.ip);
    const req = request(
      {
        method: 'POST',
        hostname: target.url.hostname.replace(/^\[|\]$/g, ''),
        port: target.url.port || 443,
        path: `${target.url.pathname}${target.url.search}`,
        headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body).toString(), 'user-agent': 'Sampan-Webhooks/1' },
        timeout: timeoutMs,
        lookup: (_host, opts, cb) => {
          if ((opts as { all?: boolean }).all) (cb as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address: target.ip, family }]);
          else cb(null, target.ip, family);
        },
      },
      (res) => {
        res.resume(); // the answer body is not read
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
    req.on('error', reject);
    req.end(body);
  });
