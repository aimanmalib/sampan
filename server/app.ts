import Fastify, { type FastifyInstance } from 'fastify';
import { publicConfig, type SampanConfig } from '../core/config.js';
import { registerActivity } from './api/activity.js';
import { registerAtom } from './api/atom.js';
import { registerBroadcast } from './api/broadcast.js';
import { registerCrossings } from './api/crossings.js';
import { registerLanding } from './api/landing.js';
import { registerIn } from './api/in.js';
import { registerOut } from './api/out.js';
import { registerPay, registerPayFiles } from './api/pay.js';
import { registerDemoHook, registerDemoShop } from './pay/demo.js';
import { registerFakePay } from './pay/fake.js';
import { registerFakeLanding } from './landing/fake.js';
import { registerSwap } from './api/swap.js';
import { registerWallet } from './api/wallet.js';
import { registerSecurityHeaders } from './security.js';
import { sendError } from './api/guard.js';
import { createServices, type Services } from './services.js';
import { registerWeb } from './static.js';
import { registerOutage, type Outage } from './outage.js';
import { registerErrorPages } from './error-page.js';

export interface AppOptions {
  config: SampanConfig;
  webDist: string;
  fake: boolean;
  /** SAMPAN_FAKE_OUTAGE, honoured only with the fake network (server/outage.ts). */
  outage?: Outage | null;
  /** SAMPAN_FAKE_INBOUND: the frozen inbound_addresses capture of the fake THORNode (fake network only). */
  fakeInbound?: string;
  logger?: boolean;
  /** SQLite file; defaults to an in-memory database (tests). */
  dbFile?: string;
  trustedProxies?: string[];
  /** Extra team wallet addresses (SAMPAN_TEST_ADDRESSES). */
  testAddresses?: string[];
  /** Transaction ids of the team's own measured runs. */
  teamTxids?: string[];
  /** SAMPAN_PAY_DEMO_SECRET: the demo shop's webhook secret; without it /api/pay/demo-hook is 404. */
  payDemoSecret?: string | undefined;
  /** SAMPAN_SPREAD_KEY: the fee wallet key, used only when pay.spreadBps > 0 (server/pay/spread.ts). */
  spreadKey?: string | undefined;
  /** ONECLICK_JWT (server env only; never logged). */
  oneClickKey?: string | undefined;
  /** Run the landing finisher in this process (default true; tests drive it by hand). */
  startWatcher?: boolean;
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
      testAddresses: options.testAddresses ?? [],
      teamTxids: options.teamTxids ?? [],
      outage: options.fake ? (options.outage ?? null) : null,
      ...(options.fake && options.fakeInbound ? { fakeInbound: options.fakeInbound } : {}),
      spreadKey: options.spreadKey,
      oneClickKey: options.oneClickKey,
      log: (m) => app.log.warn(m),
    });
  await services.clientIp.refresh();
  registerSecurityHeaders(app, config);
  const errorPages = registerErrorPages(app, config, options.webDist);
  registerPayFiles(app, config, errorPages);
  registerOutage(app, options.fake ? (options.outage ?? null) : null);

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/api/health', async () => services.health.current());
  app.get('/api/depth', async (_req, reply) => {
    try {
      return await services.depth.read();
    } catch (e) {
      return sendError(reply, e);
    }
  });
  app.get('/api/config', async () => ({ ...publicConfig(config), fake: options.fake }));
  registerWallet(app, config, services);
  registerSwap(app, config, services);
  registerBroadcast(app, config, services);
  registerAtom(app, config, services);
  registerLanding(app, config, services);
  registerOut(app, config, services);
  registerIn(app, config, services);
  registerCrossings(app, config, services);
  registerActivity(app, config, services);
  registerPay(app, config, services);
  registerDemoHook(app, config, services.demoOrders, options.payDemoSecret);
  registerDemoShop(app, config, services, options.payDemoSecret);
  if (options.fake) registerFakePay(app, config, services);
  if (options.fake) registerFakeLanding(app, config, services);
  if (options.startWatcher ?? true) {
    services.watcher.start();
    services.health.start();
    if (config.features.pay) services.webhooks.start();
  }

  const purge = setInterval(() => services.db.purgeQuotes(config.ops.quotePayloadHours), 3_600_000);
  purge.unref();
  app.addHook('onClose', async () => {
    clearInterval(purge);
    services.watcher.stop();
    services.health.stop();
    services.webhooks.stop();
    await services.chain.close();
    services.db.close();
  });

  await registerWeb(app, options.webDist, errorPages, config.ui.theme, { watch: config.features.watchDemo });
  return app;
}
