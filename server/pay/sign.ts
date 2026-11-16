// Standard Webhooks signatures (https://www.standardwebhooks.com, spec Apache-2.0): the secret is "whsec_" + base64
// of the key; the signature is "v1," + base64 HMAC-SHA256 of "<webhook-id>.<webhook-timestamp>.<body>". The same
// code signs what the server sends and checks what the demo shop's own hook receives.
import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'whsec_';

const keyOf = (secret: string): Buffer => Buffer.from(secret.startsWith(PREFIX) ? secret.slice(PREFIX.length) : secret, 'base64');

/** "v1,<base64>" for one message. `timestamp` is in whole seconds since the epoch. */
export function signWebhook(secret: string, id: string, timestamp: number, body: string): string {
  return `v1,${createHmac('sha256', keyOf(secret)).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

export interface WebhookHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}

export function webhookHeaders(secret: string, id: string, timestamp: number, body: string): WebhookHeaders {
  return { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': signWebhook(secret, id, timestamp, body) };
}

/**
 * Checks a received message: one of the space-separated v1 signatures matches and the timestamp is within
 * `toleranceSeconds` of `nowSeconds` (a replayed old message fails). Returns null when good, else the reason.
 */
export function checkWebhook(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  body: string,
  nowSeconds: number,
  toleranceSeconds: number,
): string | null {
  const one = (k: string): string | undefined => {
    const v = headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const id = one('webhook-id');
  const ts = one('webhook-timestamp');
  const sig = one('webhook-signature');
  if (!id || !ts || !sig) return 'missing webhook headers';
  if (!/^\d{1,12}$/.test(ts)) return 'bad timestamp';
  if (Math.abs(nowSeconds - Number(ts)) > toleranceSeconds) return 'timestamp too old or too new';
  const want = Buffer.from(signWebhook(secret, id, Number(ts), body).slice(3), 'base64');
  for (const part of sig.split(' ')) {
    const [version, value] = part.split(',', 2);
    if (version !== 'v1' || !value) continue;
    const got = Buffer.from(value, 'base64');
    if (got.length === want.length && timingSafeEqual(got, want)) return null;
  }
  return 'no matching signature';
}
