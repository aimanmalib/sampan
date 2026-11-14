import Fastify, { type FastifyInstance } from 'fastify';
import { publicConfig, type SampanConfig } from '../core/config.js';
import { registerSecurityHeaders } from './security.js';
import { registerWeb } from './static.js';

export interface AppOptions {
  config: SampanConfig;
  webDist: string;
  fake: boolean;
  logger?: boolean;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const app = Fastify({ logger: options.logger ?? false, trustProxy: false });
  registerSecurityHeaders(app, config);

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/api/config', async () => ({ ...publicConfig(config), fake: options.fake }));

  await registerWeb(app, options.webDist);
  return app;
}
