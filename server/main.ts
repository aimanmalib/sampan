import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { readEnv } from './env.js';

const env = readEnv();
const config = loadConfig(env.configPath);
const app = await buildApp({ config, webDist: env.webDist, fake: env.fake, logger: true });

const stop = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

await app.listen({ host: env.host, port: env.port });
