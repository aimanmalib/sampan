// What a visitor gets when the server itself fails: JSON for /api/ paths (no stack, no internal message) and,
// for pages, one plain HTML page with no script. Its text comes from the lang files, every language on one page
// since there is no script to pick one; its colours are the page's own :root tokens read from the built stylesheet.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SampanConfig } from '../core/config.js';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import { contentSecurityPolicy } from './security.js';

type Dictionary = Record<string, string>;
/** Languages in page order; the first is the page's own lang attribute. */
export const PAGE_LANGS: ReadonlyArray<[code: string, text: Dictionary]> = [
  ['en', en],
  ['ms', ms],
];

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The `:root { … }` declarations of the built stylesheet, so the error page wears the same colours. */
export function rootTokens(webDist: string): string {
  const dir = path.join(webDist, 'assets');
  if (!existsSync(dir)) return '';
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
    const match = /:root\s*\{([^}]*--paper:[^}]*)\}/.exec(readFileSync(path.join(dir, file), 'utf8'));
    if (match) return match[1]!.trim();
  }
  return '';
}

export interface ErrorPage {
  html: string;
  /** The page's CSP: the site policy with the one inline style allowed by its hash. */
  csp: string;
}

export function errorPage(kind: 'notFound' | 'failed', tokens: string, csp: string): ErrorPage {
  const style = [
    `:root{${tokens}}`,
    'body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper,Canvas);color:var(--ink,CanvasText);',
    'font-family:var(--font-text,system-ui,sans-serif);line-height:1.5}',
    'main{max-width:var(--measure,40rem);padding:var(--gap,1.5rem)}',
    'h1{font-family:var(--font-display,Georgia,serif);font-weight:600;font-size:1.75rem;margin:0 0 .5rem}',
    'section+section{margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--line,currentColor)}',
    'a{color:var(--river,LinkText);display:inline-block;min-height:var(--touch,44px);line-height:var(--touch,44px)}',
  ].join('');
  const sections = PAGE_LANGS.map(([code, t]) => {
    const text = (key: string): string => escapeHtml(t[key] ?? (en as Dictionary)[key] ?? '');
    return [
      `<section lang="${code}">`,
      `<h1>${text(`error.page.${kind}`)}</h1>`,
      `<p>${text(kind === 'failed' ? 'error.page.failedBody' : 'error.page.notFoundBody')}</p>`,
      `<p><a href="/">${text('error.page.home')}</a></p>`,
      '</section>',
    ].join('');
  }).join('');
  const html = [
    '<!doctype html>',
    `<html lang="${PAGE_LANGS[0]![0]}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="robots" content="noindex"><title>Sampan</title><style>${style}</style></head>`,
    `<body><main>${sections}</main></body></html>`,
  ].join('');
  const hash = createHash('sha256').update(style).digest('base64');
  return { html, csp: csp.replace("style-src 'self'", `style-src 'self' 'sha256-${hash}'`) };
}

const sendPage = (reply: FastifyReply, status: number, page: ErrorPage): FastifyReply =>
  reply.code(status).header('Content-Security-Policy', page.csp).type('text/html; charset=utf-8').send(page.html);

export interface ErrorPages {
  notFound(reply: FastifyReply): FastifyReply;
}

/**
 * Unhandled errors: 4xx keep Fastify's answer (validation messages the page reads); 5xx become
 * `{ error: 'server_error' }` under /api/ and the static page elsewhere. Returns the 404 page for static.ts.
 */
export function registerErrorPages(app: FastifyInstance, config: SampanConfig, webDist: string): ErrorPages {
  const csp = contentSecurityPolicy(config);
  const tokens = rootTokens(webDist);
  const failed = errorPage('failed', tokens, csp);
  const missing = errorPage('notFound', tokens, csp);
  app.setErrorHandler((error, request, reply) => {
    const code = (error as { statusCode?: unknown } | null)?.statusCode;
    const status = typeof code === 'number' && code >= 400 && code < 600 ? code : 500;
    if (status < 500) return reply.send(error);
    request.log.error(error);
    if (request.url.startsWith('/api/')) return reply.code(status).send({ error: 'server_error', message: 'the server failed; try again' });
    return sendPage(reply, status, failed);
  });
  return { notFound: (reply) => sendPage(reply, 404, missing) };
}
