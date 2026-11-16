import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { readEnv } from './env.js';

/** Set by the server build (tsup.config.ts) from docs/MEASURED.md; absent when the source runs directly. */
declare const __SAMPAN_TEAM_TXIDS__: string[] | undefined;

const env = readEnv();
const config = loadConfig(env.configPath, process.env.SAMPAN_CONFIG_PATCH);
const app = await buildApp({
  config,
  webDist: env.webDist,
  fake: env.fake,
  outage: env.fakeOutage,
  logger: true,
  dbFile: env.fake ? ':memory:' : env.dbFile,
  trustedProxies: env.trustedProxies,
  testAddresses: env.testAddresses,
  payDemoSecret: env.payDemoSecret,
  teamTxids: typeof __SAMPAN_TEAM_TXIDS__ === 'undefined' ? [] : __SAMPAN_TEAM_TXIDS__,
});

const stop = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

await app.listen({ host: env.host, port: env.port });
