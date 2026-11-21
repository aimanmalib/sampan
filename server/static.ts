// Serves the built page. Hashed assets are cached for a year; every other GET path without a file extension that is
// not /api gets index.html, except a feature page whose feature is off. Other misses: JSON 404 under /api/, the
// static 404 page elsewhere.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { ErrorPages } from './error-page.js';

/**
 * The page names the theme config ui.theme picks. The build writes it already; serving it from the running config
 * as well keeps the page and the error pages in one look when the server runs with a config patch (a theme preview
 * on a local server, ADR 0057).
 */
export function withTheme(html: string, theme: string): string {
  return html.replace(/(<html\b[^>]*\sdata-theme=)"[^"]*"/, `$1"${theme}"`);
}

/** Page paths that exist only while their feature is on; while it is off they get the static 404 page. */
export interface FeaturePaths {
  /** /watch, the no-wallet replay (features.watchDemo). */
  watch: boolean;
  /** /demo, the demo video with its chapters (features.demo). */
  demo: boolean;
  /** /slides, the event deck as full-screen slides (features.slides). */
  slides: boolean;
}

export async function registerWeb(
  app: FastifyInstance,
  webDist: string,
  errorPages: ErrorPages,
  theme: string,
  features: FeaturePaths = { watch: true, demo: true, slides: true },
): Promise<void> {
  const indexFile = path.join(webDist, 'index.html');
  const hasWeb = existsSync(indexFile);
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      index: false,
      wildcard: false,
      setHeaders(reply, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) {
          reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
  }
  const indexHtml = hasWeb ? withTheme(readFileSync(indexFile, 'utf8'), theme) : '';

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0] ?? '/';
    if (pathname.startsWith('/api/') || !hasWeb) return reply.code(404).send({ error: 'not_found' });
    if (request.method !== 'GET' || path.extname(pathname) !== '') return errorPages.notFound(reply);
    if (pathname === '/watch' && !features.watch) return errorPages.notFound(reply);
    if (pathname === '/demo' && !features.demo) return errorPages.notFound(reply);
    if (pathname === '/slides' && !features.slides) return errorPages.notFound(reply);
    return reply.type('text/html; charset=utf-8').send(indexHtml);
  });
}
