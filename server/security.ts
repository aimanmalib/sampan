// Response headers for every reply: strict CSP, no indexing before launch, no proxy rewriting of HTML.
import type { FastifyInstance } from 'fastify';
import type { SampanConfig } from '../core/config.js';

export function contentSecurityPolicy(config: SampanConfig): string {
  const connect = ["'self'", ...config.evm.chains.map((c) => new URL(c.rpc).origin)];
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${[...new Set(connect)].join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function registerSecurityHeaders(app: FastifyInstance, config: SampanConfig): void {
  const csp = contentSecurityPolicy(config);
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Content-Security-Policy', csp);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.site.noindex) reply.header('X-Robots-Tag', 'noindex, nofollow');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html')) reply.header('Cache-Control', 'no-cache, no-transform');
    if (type.startsWith('application/json')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
}
