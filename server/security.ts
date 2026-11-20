// Response headers for every reply: strict CSP, no indexing before launch, no proxy rewriting of HTML.
import type { FastifyInstance } from 'fastify';
import { atomConnectOrigins } from '../core/atom-config.js';
import type { SampanConfig } from '../core/config.js';
import { nostrConnectSources } from '../core/nostr-config.js';

export function contentSecurityPolicy(config: SampanConfig): string {
  const walletConnect = config.evm.walletConnectProjectId !== '';
  const connect = [
    "'self'",
    ...config.evm.chains.flatMap((c) => c.rpc.map((u) => new URL(u).origin)),
    ...config.connect.relayUrls.map((u) => new URL(u).origin),
    // WalletConnect for EVM wallets: its relay only, and only when a project id is set.
    ...(walletConnect ? [new URL(config.evm.walletConnectRelay).origin] : []),
    // The atomic swap client talks to its own Electrum servers and Base RPCs; nothing is allowed for it while it is off.
    ...atomConnectOrigins(config.features.atom, config.atom),
    // Nostr identities: the configured relays, plus https: for a name's own domain (NIP-05); nothing while the feature is off.
    ...nostrConnectSources(config.features.nostrSend, config.nostrId),
  ];
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    // The /demo videos come from the media host (ADR 0084); their subtitle tracks from this site.
    `media-src 'self' https://${config.media.host}`,
    `connect-src ${[...new Set(connect)].join(' ')}`,
    // WalletConnect Verify attests the page's origin in a frame of its own; no other frame is allowed.
    ...(walletConnect ? [`frame-src ${new URL(config.evm.walletConnectVerify).origin}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * The one exception to same-origin: Sampan Pay's API is called from merchants' pages, so /api/pay/* answers any
 * origin, without cookies or credentials (Sampan sets none). Every other route keeps the browser default.
 */
export const CORS_OPEN_PREFIX = '/api/pay/';

export function corsHeaders(url: string): Record<string, string> {
  if (!url.startsWith(CORS_OPEN_PREFIX)) return {};
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
  };
}

export function registerSecurityHeaders(app: FastifyInstance, config: SampanConfig): void {
  const csp = contentSecurityPolicy(config);
  app.addHook('onSend', async (request, reply, payload) => {
    for (const [name, value] of Object.entries(corsHeaders(request.url))) reply.header(name, value);
    // The static error page sets its own policy (the site policy plus its one inline style hash).
    if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', csp);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.site.noindex) reply.header('X-Robots-Tag', 'noindex, nofollow');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html')) reply.header('Cache-Control', 'no-cache, no-transform');
    if (type.startsWith('application/json')) reply.header('Cache-Control', 'no-store');
    if (type.startsWith('image/svg+xml')) reply.header('Content-Security-Policy', "default-src 'none'");
    return payload;
  });
}
