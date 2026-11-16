import { expect, test } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };

// Runs against the fake server with the landing flow on, or against the live site (E2E_BASE_URL, deploy/deploy.sh).
const landingPort = Number(process.env.E2E_PORT ?? 4173) + 1;
test.use({ baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${landingPort}` });

test('/how shows the open flows, the whole contract, the checks anyone can run and the measured line', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('link', { name: en['footer.how'] }).click();
  await expect(page).toHaveURL(/\/how$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['how.title']);
  const cfg = (await (await page.request.get('/api/config')).json()) as { features: { swap: boolean; landing: boolean } };
  expect(cfg.features.landing).toBe(true);
  await expect(page.getByRole('heading', { name: en['how.land.title'], exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: en['how.swap.title'], exact: true })).toHaveCount(cfg.features.swap ? 1 : 0);
  await expect(page.locator('.how__source')).toContainText('contract Landing(');
  await expect(page.locator('.how__source')).toContainText('function giveBack()');
  await expect(page.getByText('npm run verify-landing -- card.json')).toBeVisible();
  await expect(page.getByText('npm run finisher -- card.json')).toBeVisible();
  await expect(page.getByRole('heading', { name: en['how.exists.title'] })).toBeVisible();
  await expect(page.locator('.measured__line')).toContainText(/\d+ landings and crossings completed/);
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
  await page.getByRole('button', { name: en['lang.switchLabel'] }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ms['how.title']);
  expect(errors).toEqual([]);
});

test('/how fits a 320 px screen with the contract source scrolling inside its box', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/how');
  await expect(page.locator('.how__source')).toBeVisible();
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
});
