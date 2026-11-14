// Serves the built page. Hashed assets are cached for a year; every other path that is not /api gets index.html.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export async function registerWeb(app: FastifyInstance, webDist: string): Promise<void> {
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
    if (request.method !== 'GET' || pathname.startsWith('/api/') || !hasWeb) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (path.extname(pathname) !== '') return reply.code(404).send({ error: 'not_found' });
    return reply.type('text/html; charset=utf-8').send(indexHtml);
  });
}
