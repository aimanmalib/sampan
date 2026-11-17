import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { livePatch, type RouteAsset } from './core/route-assets.js';

const port = Number(process.env.E2E_PORT ?? 4173);
/** A second fake server with the landing flow switched on (e2e/land.spec.ts points its baseURL here). */
const landingPort = port + 1;
/** A third fake server with crossings to other chains on, against the fake THORNode (e2e/out.spec.ts). */
const outPort = port + 2;
// E2E_BASE_URL checks a running site (deploy/deploy.sh points it at the public URL); otherwise a local fake server starts.
const live = process.env.E2E_BASE_URL;
// The local fake server shows the swap flow alone (the landing flow has its own server below), and its rate
// limits are lifted because every browser in the run shares one IP.
const e2ePatch = { features: { swap: true, landing: false }, rate: { quotesPerMinute: 1000, crossingsPerHour: 1000 } };
const landingPatch = { ...e2ePatch, features: { swap: true, landing: true } };
// Crossings run against the fake THORNode, which reports Base open: Base USDC is switched live on this server only.
const shippedAssets = (JSON.parse(readFileSync('config/sampan.json', 'utf8')) as { thorchain: { assets: RouteAsset[] } }).thorchain.assets;
const outPatch = { ...e2ePatch, compliance: { crossChainEnabled: true }, ...livePatch(shippedAssets, ['BASE']) };
/** One fake server per SAMPAN_FAKE_OUTAGE mode, on the ports after the three above (e2e/outage.spec.ts). */
export const OUTAGE_MODES = ['indexer', 'electrum', 'api', 'chunk', 'render', 'app'] as const;
const outagePort = (i: number) => port + 3 + i;
/** A fake server with Sampan Pay on (e2e/pay.spec.ts), after the outage servers. */
export const PAY_PORT_OFFSET = 3 + OUTAGE_MODES.length;
const payPatch = { ...e2ePatch, features: { swap: true, landing: true, pay: true }, rate: { ...e2ePatch.rate, invoicesPerHour: 1000 } };
/**
 * A fake server with crossings on several chains (e2e/network.spec.ts), after the Pay server: Ethereum, BNB Smart Chain
 * and Base are live, and the fake THORNode answers with the 2026-11-17 capture, in which Base is halted.
 */
export const NETWORK_PORT_OFFSET = PAY_PORT_OFFSET + 1;
const networkPatch = { ...landingPatch, compliance: { crossChainEnabled: true }, ...livePatch(shippedAssets, ['ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', 'BSC', 'BASE']) };
/** Test-only secret of the demo shop's hook on the local fake server (the public site's secret lives on the host). */
const payEnv = { SAMPAN_PAY_DEMO_SECRET: `whsec_${Buffer.alloc(32, 3).toString('base64')}` };
const fakeServer = (p: number, patch: unknown, outage?: string, extra: Record<string, string> = {}) => ({
  command: 'node dist/server/main.js',
  url: `http://127.0.0.1:${p}/healthz`,
  reuseExistingServer: false,
  timeout: 30_000,
  env: { PORT: String(p), HOST: '127.0.0.1', SAMPAN_FAKE: '1', SAMPAN_CONFIG_PATCH: JSON.stringify(patch), ...(outage ? { SAMPAN_FAKE_OUTAGE: outage } : {}), ...extra },
});

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'dot' : 'list',
  use: { baseURL: live ?? `http://127.0.0.1:${port}` },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-iphone13', use: { ...devices['iPhone 13'] } },
  ],
  ...(live
    ? {}
    : {
        webServer: [
          fakeServer(port, e2ePatch),
          fakeServer(landingPort, landingPatch),
          fakeServer(outPort, outPatch),
          ...OUTAGE_MODES.map((mode, i) => fakeServer(outagePort(i), e2ePatch, mode)),
          fakeServer(port + PAY_PORT_OFFSET, payPatch, undefined, payEnv),
          fakeServer(port + NETWORK_PORT_OFFSET, networkPatch, undefined, { SAMPAN_FAKE_INBOUND: 'inbound-2026-11-17.json' }),
        ],
      }),
});
