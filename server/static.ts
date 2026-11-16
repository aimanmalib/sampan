// Serves the built page. Hashed assets are cached for a year; every other GET path without a file extension that is
// not /api gets index.html. Other misses: JSON 404 under /api/, the static 404 page elsewhere.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { ErrorPages } from './error-page.js';

export async function registerWeb(app: FastifyInstance, webDist: string, errorPages: ErrorPages): Promise<void> {
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
  const indexHtml = hasWeb ? readFileSync(indexFile, 'utf8') : '';

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0] ?? '/';
    if (pathname.startsWith('/api/') || !hasWeb) return reply.code(404).send({ error: 'not_found' });
    if (request.method !== 'GET' || path.extname(pathname) !== '') return errorPages.notFound(reply);
    return reply.type('text/html; charset=utf-8').send(indexHtml);
  });
}
