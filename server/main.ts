import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { readEnv } from './env.js';

const env = readEnv();
const config = loadConfig(env.configPath, process.env.SAMPAN_CONFIG_PATCH);
const app = await buildApp({
  config,
  webDist: env.webDist,
  fake: env.fake,
  logger: true,
  dbFile: env.fake ? ':memory:' : env.dbFile,
  trustedProxies: env.trustedProxies,
});

const stop = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

await app.listen({ host: env.host, port: env.port });
