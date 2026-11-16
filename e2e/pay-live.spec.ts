// Sampan Pay on the running site (E2E_BASE_URL; deploy/deploy.sh runs it after each deploy). It makes no order and
// pays nothing: it checks that the flag is on, pay.js is served as JavaScript, the demo shop page renders without
// console errors or overflow, and Pay stays off the first screen. With E2E_PAY_INVOICE set to a paid demo order
// (tools/measure/pay.ts --live prints it), it also checks that order's status page: paid, two transactions, order
// fulfilled after the signed webhook. Skipped while the tracked config keeps Pay off.
import { expect, test, type Page } from '@playwright/test';
import repoConfig from '../config/sampan.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };

const PAID = en['pay.inv.status.paid'].split('{')[0]!.trim();

test.skip(!process.env.E2E_BASE_URL, 'checks the running site');
test.skip(!repoConfig.features.pay, 'Sampan Pay is off in config');

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function noOverflow(page: Page, label: string): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll, label).toBeLessThanOrEqual(client);
}

async function shot(page: Page, errors: string[], name: string, project: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  const before = errors.length;
  await page.screenshot({ path: `${dir}/sampan-pay-live-${name}-${project}.png`, fullPage: true });
  await page.waitForTimeout(100);
  errors.splice(before);
}

test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'chromium-desktop') await page.setViewportSize({ width: 1440, height: 900 });
});

test('the flag is on and pay.js is JavaScript', async ({ request }) => {
  const config = (await (await request.get('/api/config')).json()) as { features: { pay: boolean } };
  expect(config.features.pay).toBe(true);
  const js = await request.get('/pay.js');
  expect(js.status()).toBe(200);
  expect(js.headers()['content-type']).toMatch(/javascript/);
});

test('Pay is not on the first screen; the footer link opens the demo shop', async ({ page }, info) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const link = page.locator('footer').getByRole('link', { name: en['footer.merchants'] });
  await expect(link).toHaveCount(1);
  await expect(link).not.toBeInViewport();
  await expect(page.locator('main a[href^="/pay"]')).toHaveCount(0);
  await link.click();
  await expect(page).toHaveURL(/\/pay$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['pay.shop.title']);
  await expect(page.getByRole('button', { name: en['pay.shop.buy'] })).toBeVisible();
  await noOverflow(page, '/pay');
  await shot(page, errors, 'shop', info.project.name);
  expect(errors).toEqual([]);
});

test('the paid demo order reads paid and fulfilled', async ({ page }, info) => {
  const id = process.env.E2E_PAY_INVOICE;
  test.skip(!id, 'E2E_PAY_INVOICE names a paid demo order');
  const errors = collectErrors(page);
  await page.goto(`/pay/i/${id}`);
  await expect(page.locator('.payinv__status')).toContainText(PAID, { timeout: 15_000 });
  await expect(page.locator('.payinv__tx')).toHaveCount(2);
  await expect(page.locator('.payinv__box')).toHaveCount(0);
  await expect(page.locator('.payinv__order')).toHaveText(en['pay.inv.order.fulfilled'], { timeout: 15_000 });
  await noOverflow(page, 'status page paid');
  await shot(page, errors, 'invoice-paid', info.project.name);
  expect(errors).toEqual([]);
});
