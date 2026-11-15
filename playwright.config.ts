import { defineConfig, devices } from '@playwright/test';

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
const outPatch = { ...e2ePatch, compliance: { crossChainEnabled: true } };
const fakeServer = (p: number, patch: unknown) => ({
  command: 'node dist/server/main.js',
  url: `http://127.0.0.1:${p}/healthz`,
  reuseExistingServer: false,
  timeout: 30_000,
  env: { PORT: String(p), HOST: '127.0.0.1', SAMPAN_FAKE: '1', SAMPAN_CONFIG_PATCH: JSON.stringify(patch) },
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
        webServer: [fakeServer(port, e2ePatch), fakeServer(landingPort, landingPatch), fakeServer(outPort, outPatch)],
      }),
});
