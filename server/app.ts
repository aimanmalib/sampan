import Fastify, { type FastifyInstance } from 'fastify';
import { publicConfig, type SampanConfig } from '../core/config.js';
import { registerBroadcast } from './api/broadcast.js';
import { registerCrossings } from './api/crossings.js';
import { registerSwap } from './api/swap.js';
import { registerWallet } from './api/wallet.js';
import { registerSecurityHeaders } from './security.js';
import { createServices, type Services } from './services.js';
import { registerWeb } from './static.js';

export interface AppOptions {
  config: SampanConfig;
  webDist: string;
  fake: boolean;
  logger?: boolean;
  /** SQLite file; defaults to an in-memory database (tests). */
  dbFile?: string;
  trustedProxies?: string[];
  /** Ready-made services (tests); otherwise built from the options above. */
  services?: Services;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config } = options;
  // Unknown body fields are an error, not silently dropped.
  const app = Fastify({ logger: options.logger ?? false, trustProxy: false, ajv: { customOptions: { removeAdditional: false } } });
  const services =
    options.services ??
    createServices({
      config,
      fake: options.fake,
      dbFile: options.dbFile ?? ':memory:',
      trustedProxies: options.trustedProxies ?? [],
      log: (m) => app.log.warn(m),
    });
  await services.clientIp.refresh();
  registerSecurityHeaders(app, config);

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/api/config', async () => ({ ...publicConfig(config), fake: options.fake }));
  registerWallet(app, config, services);
  registerSwap(app, config, services);
  registerBroadcast(app, config, services);
  registerCrossings(app, services);

  const purge = setInterval(() => services.db.purgeQuotes(config.ops.quotePayloadHours), 3_600_000);
  purge.unref();
  app.addHook('onClose', async () => {
    clearInterval(purge);
    await services.chain.close();
    services.db.close();
  });

  await registerWeb(app, options.webDist);
  return app;
}
