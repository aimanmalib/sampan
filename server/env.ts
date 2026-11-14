// Process settings that differ between a laptop, CI and the host. Product values live in config/sampan.json.
import path from 'node:path';

export interface ServerEnv {
  host: string;
  port: number;
  configPath: string;
  webDist: string;
  /** SAMPAN_FAKE=1: providers answer from fixtures; nothing leaves the machine. */
  fake: boolean;
  /** SQLite file inside SAMPAN_DATA (the volume in production). */
  dbFile: string;
  /** SAMPAN_TRUSTED_PROXY: comma-separated names or IPs of the reverse proxy allowed to set X-Forwarded-For. */
  trustedProxies: string[];
}

export function readEnv(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerEnv {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`PORT is not a valid port: ${env.PORT}`);
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    configPath: path.resolve(cwd, env.SAMPAN_CONFIG ?? 'config/sampan.json'),
    webDist: path.resolve(cwd, env.SAMPAN_WEB_DIST ?? 'web/dist'),
    fake: env.SAMPAN_FAKE === '1',
    dbFile: path.resolve(cwd, env.SAMPAN_DATA ?? 'data', 'sampan.db'),
    trustedProxies: (env.SAMPAN_TRUSTED_PROXY ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  };
}
