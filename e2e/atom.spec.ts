// The "Choose a route" card against the cross-chain fake server, with the atomic swap service answered from frozen
// fixtures (page.route on /atom/api) and the route switched on in the config the page reads. The client file is the
// real minified build. With the flag off, or a service that names another AtomLock, the page shows THORChain alone.
// Skipped against a live site.
import { expect, test } from '@playwright/test';
import { HEALTH, INVENTORY, noHorizontalOverflow, primary, routeOn, routes, row, service, watch } from './atom-fake.js';
import en from '../lang/en.json' with { type: 'json' };

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

const outPort = Number(process.env.E2E_PORT ?? 4173) + 2;
test.use({ baseURL: `http://127.0.0.1:${outPort}` });


test('Send out shows both routes for the same amount, THORChain selected, and the atom row can be chosen by keyboard', async ({ page }) => {
  const seen = watch(page);
  await routeOn(page);
  await service(page);
  const health = page.waitForResponse((r) => r.url().includes('/atom/api/health'));
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await health;
  const quote = page.waitForResponse((r) => r.url().includes('/atom/api/quote'));
  await page.locator('.out .field__input').first().fill('1');
  await quote;

  await expect(routes(page)).toBeVisible();
  await expect(routes(page).locator('legend')).toHaveText(en['compare.title']);
  await expect(row(page, 'thorchain').getByRole('radio')).toBeChecked();
  await expect(row(page, 'atom')).toContainText('You receive about 1.00 USDC');
  await expect(row(page, 'atom')).toContainText('Network fees: 4700 sats on Bitcoin Cash + 69234 gas units on Base');
  await expect(row(page, 'atom')).toContainText('Measured: about 29 min, from 1 run.');
  await row(page, 'atom').locator('summary').click();
  await expect(row(page, 'atom')).toContainText('Your lock returns to you after 54 Bitcoin Cash blocks.');
  await expect(primary(page)).toHaveText(en['wallet.connect']);

  await row(page, 'thorchain').getByRole('radio').focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'atom').getByRole('radio')).toBeChecked();
  await expect(primary(page)).toHaveText(en['atom.go']);
  // The atom run needs the BCH wallet that pays the contract: without it the button waits and says why.
  await expect(primary(page)).toBeDisabled();
  await expect(page.locator('.out .card__note')).toHaveText(en['atom.needBch'].replace('{token}', 'PUSD'));

  await page.setViewportSize({ width: 320, height: 640 });
  await routes(page).scrollIntoViewIfNeeded();
  await noHorizontalOverflow(page);
  expect(seen.client).toEqual(['/vendor/atom-client-1b6c6f7.min.js']);
  expect(seen.errors).toEqual([]);
});

test('Bring in to PUSD shows the atom row for USDC on Base', async ({ page }) => {
  const seen = watch(page);
  await routeOn(page);
  await service(page);
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  const quote = page.waitForResponse((r) => r.url().includes('/atom/api/quote'));
  await page.locator('.in .field__input').first().fill('2');
  await quote;
  await expect(row(page, 'atom')).toContainText('You receive about 2.00 PUSD');
  await expect(row(page, 'atom')).toContainText('Network fees: 178012 gas units on Base + 0 sats on Bitcoin Cash');
  await expect(row(page, 'thorchain').getByRole('radio')).toBeChecked();
  expect(seen.atom.filter((p) => p.endsWith('/quote'))).not.toHaveLength(0);
  expect(seen.errors).toEqual([]);
});

test('a refused quote is shown as unavailable with its reason and cannot be chosen', async ({ page }) => {
  const seen = watch(page);
  await routeOn(page);
  await service(page, { quote: () => INVENTORY });
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  const quote = page.waitForResponse((r) => r.url().includes('/atom/api/quote'));
  await page.locator('.out .field__input').first().fill('1');
  await quote;
  await expect(row(page, 'atom')).toContainText(`Not available now: ${en['compare.reason.inventory']}.`);
  await expect(row(page, 'atom').getByRole('radio')).toBeDisabled();
  await expect(row(page, 'thorchain').getByRole('radio')).toBeChecked();
  await expect(primary(page)).toHaveText(en['wallet.connect']);
  // The service answers a refused quote with HTTP 422 (its documented contract); the browser logs that status line itself.
  expect(seen.errors.filter((e) => !/status of 422/.test(e))).toEqual([]);
});

test('a service that names another AtomLock leaves the route out and is never asked for a quote', async ({ page }) => {
  const seen = watch(page);
  await routeOn(page);
  await service(page, { health: { ...HEALTH, atomLock: '0x0000000000000000000000000000000000000001' } });
  const health = page.waitForResponse((r) => r.url().includes('/atom/api/health'));
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await health;
  await expect.poll(() => seen.info).toContain('atom route hidden: atom-lock');
  await page.getByPlaceholder('0x…').fill('0x1a877169bB03400fA69EC4813889E78994D194Cb');
  await expect(page.locator('.swap__receive')).toContainText(/You receive about [0-9.]+ USDC/, { timeout: 10_000 });
  await expect(routes(page)).toHaveCount(0);
  expect(seen.atom).toEqual(['/atom/api/health']);
  expect(seen.errors).toEqual([]);
});

test('with the flag off the page asks for neither the client nor the service', async ({ page }) => {
  const seen = watch(page);
  await service(page);
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await page.getByPlaceholder('0x…').fill('0x1a877169bB03400fA69EC4813889E78994D194Cb');
  await expect(page.locator('.swap__receive')).toContainText(/You receive about [0-9.]+ USDC/, { timeout: 10_000 });
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.locator('.in .field__input').first().fill('2');
  await expect(page.locator('.in .swap__receive')).toBeVisible();
  await expect(routes(page)).toHaveCount(0);
  expect(seen.client).toEqual([]);
  expect(seen.atom).toEqual([]);
  expect(seen.errors).toEqual([]);
});
