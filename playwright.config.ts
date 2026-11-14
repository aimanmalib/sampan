import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
// E2E_BASE_URL checks a running site (deploy/deploy.sh points it at the public URL); otherwise a local fake server starts.
const live = process.env.E2E_BASE_URL;

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
        webServer: {
          command: 'node dist/server/main.js',
          url: `http://127.0.0.1:${port}/healthz`,
          reuseExistingServer: false,
          timeout: 30_000,
          env: { PORT: String(port), HOST: '127.0.0.1', SAMPAN_FAKE: '1' },
        },
      }),
});
