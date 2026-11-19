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
// The local fake server shows the swap flow alone (the landing flow has its own server below; crossings are off here
// whatever the shipped config says), and its rate
// limits are lifted because every browser in the run shares one IP.
const e2ePatch = { features: { swap: true, landing: false, watchDemo: false }, compliance: { crossChainEnabled: false }, rate: { quotesPerMinute: 1000, crossingsPerHour: 1000 } };
// The page asks for a landing's status every 2 s here (e2e/qr-close.spec.ts waits on it), not every 10 s as shipped,
// and the no-wallet landing replay /watch is on (e2e/watch.spec.ts; the main server above keeps it off).
const landingPatch = { ...e2ePatch, features: { swap: true, landing: true, watchDemo: true }, landing: { pagePollSeconds: 2 } };
// Crossings run against the fake THORNode, which reports Base open: Base USDC is switched live on this server only.
// Every asset starts off here, so a server's live list is exactly the one its patch names (not what the file marks live).
const shippedAssets = (JSON.parse(readFileSync('config/sampan.json', 'utf8')) as { thorchain: { assets: RouteAsset[] } }).thorchain.assets.map(
  (a) => ({ ...a, live: { out: false, in: false } }),
);
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
// "You keep" per network is on here only (e2e/keep.spec.ts); the shipped flag stays off until it is measured live.
const networkPatch = { ...landingPatch, features: { ...landingPatch.features, keepCompare: true }, compliance: { crossChainEnabled: true }, ...livePatch(shippedAssets, ['ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', 'BSC', 'BASE']) };
/** A fake server with the landing flow on and the QR opening by itself switched off (e2e/qr-first.spec.ts). */
export const QR_OFF_PORT_OFFSET = NETWORK_PORT_OFFSET + 1;
const qrOffPatch = { ...landingPatch, ui: { qrAutoOpen: false } };
/**
 * A fake server with the 1Click route on (e2e/oneclick.spec.ts): the cross-chain server plus features.oneClick, and
 * 1Click answered by the synthetic fake, every configured 1Click asset live here only (Base USDC included), so one
 * request can show the THORChain, atomic swap and 1Click rows together.
 */
export const ONECLICK_PORT_OFFSET = QR_OFF_PORT_OFFSET + 1;
const shippedOneClick = (JSON.parse(readFileSync('config/sampan.json', 'utf8')) as { oneClick: { assets: Array<Record<string, unknown>> } }).oneClick.assets;
const oneClickPatch = {
  ...outPatch,
  features: { ...e2ePatch.features, oneClick: true },
  oneClick: {
    assets: [
      ...shippedOneClick.map((a) => ({ ...a, live: { out: true, in: true } })),
    ],
  },
};
/**
 * A fake server with the shipped flows as the config file has them (landing flow on, crossings and live assets
 * untouched), so the first-screen rule is checked on the page the live site shows (e2e/first-screen.spec.ts).
 */
export const SHIPPED_PORT_OFFSET = ONECLICK_PORT_OFFSET + 1;
const shippedPatch = { features: { swap: true, landing: true }, rate: e2ePatch.rate };
/**
 * A fake server with the landing flow and Nostr identities on (e2e/nostr.spec.ts): the page asks the relays in config,
 * which the spec answers itself with page.routeWebSocket.
 */
export const NOSTR_PORT_OFFSET = SHIPPED_PORT_OFFSET + 1;
const nostrPatch = { ...landingPatch, features: { ...landingPatch.features, nostrSend: true } };
/** Test-only secret of the demo shop's hook on the local fake server (the public site's secret lives on the host). */
const payEnv = { SAMPAN_PAY_DEMO_SECRET: `whsec_${Buffer.alloc(32, 3).toString('base64')}` };
/**
 * E2E_THEME runs every fake server in that look (config ui.theme), so the layout and contrast specs can be repeated per
 * theme (scripts/gerbang-ujian.sh); unset, the servers wear the shipped theme.
 */
export const E2E_THEME = process.env.E2E_THEME;
const themed = (patch: object): object => (E2E_THEME ? { ...patch, ui: { ...(patch as { ui?: object }).ui, theme: E2E_THEME } } : patch);
const fakeServer = (p: number, patch: object, outage?: string, extra: Record<string, string> = {}) => ({
  command: 'node dist/server/main.js',
  url: `http://127.0.0.1:${p}/healthz`,
  reuseExistingServer: false,
  timeout: 30_000,
  env: { PORT: String(p), HOST: '127.0.0.1', SAMPAN_FAKE: '1', SAMPAN_CONFIG_PATCH: JSON.stringify(themed(patch)), ...(outage ? { SAMPAN_FAKE_OUTAGE: outage } : {}), ...extra },
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
          fakeServer(port + QR_OFF_PORT_OFFSET, qrOffPatch),
          fakeServer(port + ONECLICK_PORT_OFFSET, oneClickPatch),
          fakeServer(port + SHIPPED_PORT_OFFSET, shippedPatch),
          fakeServer(port + NOSTR_PORT_OFFSET, nostrPatch),
        ],
      }),
});
