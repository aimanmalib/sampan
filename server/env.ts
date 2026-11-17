// Process settings that differ between a laptop, CI and the host. Product values live in config/sampan.json.
import path from 'node:path';
import { parseOutage, type Outage } from './outage.js';

export interface ServerEnv {
  host: string;
  port: number;
  configPath: string;
  webDist: string;
  /** SAMPAN_FAKE=1: providers answer from fixtures; nothing leaves the machine. */
  fake: boolean;
  /** SAMPAN_FAKE_OUTAGE (fake network only): one provider or part of the page fails on purpose (server/outage.ts). */
  fakeOutage: Outage | null;
  /** SAMPAN_FAKE_INBOUND (fake network only): which frozen inbound_addresses capture the fake THORNode answers with. */
  fakeInbound: string | null;
  /** SQLite file inside SAMPAN_DATA (the volume in production). */
  dbFile: string;
  /** SAMPAN_TRUSTED_PROXY: comma-separated names or IPs of the reverse proxy allowed to set X-Forwarded-For. */
  trustedProxies: string[];
  /** SAMPAN_TEST_ADDRESSES: comma-separated extra addresses of the team's own wallets (host only, not in the repo). */
  testAddresses: string[];
  /** SAMPAN_PAY_DEMO_SECRET: Standard Webhooks secret of the demo shop's own hook (host only). */
  payDemoSecret: string | undefined;
  /** SAMPAN_SPREAD_KEY: hex key of business.feeAddress, read only when pay.spreadBps > 0 (never on the public site). */
  spreadKey: string | undefined;
}

/** A capture file name under tests/fixtures/thorchain; anything else is an error so a typo cannot pass silently. */
function parseInbound(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  if (!/^inbound(-[0-9a-z-]+)?\.json$/.test(value)) throw new Error('SAMPAN_FAKE_INBOUND must name an inbound*.json capture');
  return value;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerEnv {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`PORT is not a valid port: ${env.PORT}`);
  const list = (v: string | undefined): string[] =>
    (v ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    configPath: path.resolve(cwd, env.SAMPAN_CONFIG ?? 'config/sampan.json'),
    webDist: path.resolve(cwd, env.SAMPAN_WEB_DIST ?? 'web/dist'),
    fake: env.SAMPAN_FAKE === '1',
    fakeOutage: env.SAMPAN_FAKE === '1' ? parseOutage(env.SAMPAN_FAKE_OUTAGE) : null,
    fakeInbound: env.SAMPAN_FAKE === '1' ? parseInbound(env.SAMPAN_FAKE_INBOUND) : null,
    dbFile: path.resolve(cwd, env.SAMPAN_DATA ?? 'data', 'sampan.db'),
    trustedProxies: list(env.SAMPAN_TRUSTED_PROXY),
    testAddresses: list(env.SAMPAN_TEST_ADDRESSES),
    payDemoSecret: env.SAMPAN_PAY_DEMO_SECRET || undefined,
    spreadKey: env.SAMPAN_SPREAD_KEY || undefined,
  };
}
