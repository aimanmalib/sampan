// The hero line follows the route's live state (KMN1, ADR 0067), against the network fake server: crossings on, USDC on
// Ethereum, USDC and USDT on BNB Smart Chain and USDC on Base live, and the fake THORNode reporting Base halted
// (2026-11-17 capture). Open: the line names the stablecoins the open chains carry. THORChain reported halted: the line
// and the page description name no stablecoin and promise no crossing, though the flags are on. Only Ethereum open:
// USDC alone. Skipped against a live site.
import { expect, test, type Page, type Route } from '@playwright/test';
import { NETWORK_PORT_OFFSET } from '../playwright.config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + NETWORK_PORT_OFFSET}` });

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Rewrites every /api/health answer: the route's open state and per-chain map as given. */
async function routeReports(page: Page, open: boolean, chains: Record<string, boolean>): Promise<void> {
  await page.route('**/api/health', async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { route: { open: boolean | null; chains?: Record<string, boolean> | null } | null };
    body.route = { ...body.route!, open, chains };
    await route.fulfill({ response: res, json: body });
  });
}

const sub = (page: Page) => page.locator('.hero__sub');
/** The status line's route part once the page has drawn the report (the hero reads the same report). */
const routeShown = (page: Page, state: 'ok' | 'halted') => expect(page.locator(`[data-health="route"].health__part--${state}`)).toBeVisible();
const description = (page: Page) => page.evaluate(() => document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '');

test('open route: the hero names the stablecoins its open chains carry', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await routeShown(page, 'ok');
  await expect(sub(page)).toContainText('USDC');
  await expect(sub(page)).toContainText('USDT');
  expect(await description(page)).toContain('USDC');
  expect(errors).toEqual([]);
});

test('route reported halted: the hero promises no crossing and names no stablecoin', async ({ page }) => {
  const errors = collectErrors(page);
  // The route's own verdict wins even where its chain map still marks chains open (trading halted on the whole route).
  await routeReports(page, false, { BCH: true, ETH: true, BSC: true, BASE: false });
  await page.goto('/');
  await routeShown(page, 'halted');
  await expect(sub(page)).toBeVisible();
  // The line drawn after the report: no stablecoin, no crossing promise; the description set from it likewise.
  await expect(sub(page)).not.toContainText(/USDC|USDT|in and out/);
  expect(await description(page)).not.toMatch(/USDC|USDT|in and out/);
  expect(errors).toEqual([]);
});

test('only Ethereum open: the hero names USDC alone', async ({ page }) => {
  await routeReports(page, true, { BCH: true, ETH: true, BSC: false, BASE: false });
  await page.goto('/');
  await routeShown(page, 'ok');
  await expect(sub(page)).toContainText('USDC');
  await expect(sub(page)).not.toContainText('USDT');
});
