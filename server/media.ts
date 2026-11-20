// The demo videos (ADR 0084). The site's own host name goes through a CDN whose terms do not cover video, so the files
// live in media/ and are served only to the media host name (config media.host), which points at this same server
// without the CDN. Any other host asking for /media/* gets the 404 page. Range requests answer 206, as players ask.
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { MediaConfig } from '../core/demo.js';
import type { ErrorPages } from './error-page.js';

export const MEDIA_PREFIX = '/media/';

export async function registerMedia(app: FastifyInstance, mediaDir: string, media: MediaConfig, errorPages: ErrorPages): Promise<void> {
  await app.register(async (scope) => {
    scope.addHook('onRequest', async (request, reply) => {
      if (request.hostname.toLowerCase() !== media.host) return errorPages.notFound(reply);
    });
    await scope.register(fastifyStatic, {
      root: path.resolve(mediaDir),
      prefix: MEDIA_PREFIX,
      decorateReply: false,
      index: false,
      list: false,
      cacheControl: false,
      setHeaders(reply) {
        reply.header('Cache-Control', media.cacheControl);
      },
    });
  });
}
