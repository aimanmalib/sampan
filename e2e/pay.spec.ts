// Sampan Pay against a fake server with features.pay on: the demo shop makes an order, the status page shows the
// address, QR code, amount and time left; a fake payment turns it paid and converted, and the demo shop's signed
// webhook (answered in-process) turns the order fulfilled. An expired invoice offers no address. The example page
// loads pay.js and its button opens the status page in a new tab. Also: no page overflows at 320 px.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { PAY_PORT_OFFSET } from '../playwright.config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server with Sampan Pay on');
const payPort = Number(process.env.E2E_PORT ?? 4173) + PAY_PORT_OFFSET;
test.use({ baseURL: `http://127.0.0.1:${payPort}` });

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

/** With E2E_SHOTS_DIR set, saves a full-page screenshot (console errors the screenshot itself causes are dropped). */
async function shot(page: Page, errors: string[], name: string, project: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  const before = errors.length;
  await page.screenshot({ path: `${dir}/sampan-pay-${name}-${project}.png`, fullPage: true });
  await page.waitForTimeout(100);
  errors.splice(before);
}

async function order(page: Page): Promise<string> {
  await page.goto('/pay');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['pay.shop.title']);
  await expect(page.locator('.button--primary')).toHaveCount(1);
  await page.getByRole('button', { name: en['pay.shop.buy'] }).click();
  await page.waitForURL(/\/pay\/i\/[0-9a-f]{32}$/);
  return new URL(page.url()).pathname.split('/').pop()!;
}

test('demo shop: order, status page, paid, converted, order fulfilled', async ({ page, request }, info) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('footer').getByRole('link', { name: en['footer.merchants'] })).toBeVisible();
  const id = await order(page);
  await expect(page.locator('.payinv__badge')).toHaveText(en['pay.inv.demo']);
  await expect(page.locator('.payinv__address')).toHaveText(/^bitcoincash:p[0-9a-z]{41}$/);
  await expect(page.locator('.payinv__bch')).toHaveText(/^0\.\d+ BCH$/);
  await expect(page.locator('svg.payqr')).toBeVisible();
  await expect(page.locator('.payinv__open')).toHaveAttribute('href', /^bitcoincash:p[0-9a-z]{41}\?amount=0\.\d+$/);
  await expect(page.locator('.payinv__time')).toHaveText(/\d\d:\d\d/);
  await expect(page.locator('.payinv__status')).toHaveText(en['pay.inv.status.open']);
  await noOverflow(page, 'status page open');
  await shot(page, errors, 'invoice-open', info.project.name);

  expect((await request.post(`/api/pay/fake/pay/${id}`, { data: {} })).ok()).toBe(true);
  await page.getByRole('button', { name: en['crossing.check'] }).click();
  await expect(page.locator('.payinv__status')).toContainText('Paid. The shop received', { timeout: 15_000 });
  await expect(page.locator('.payinv__box')).toHaveCount(0);
  await expect(page.locator('.payinv__lead')).toHaveCount(0);
  await expect(page.locator('.payinv__tx')).toHaveCount(2);
  // The demo shop hands the order over only after its server checked the signed webhook.
  await expect(page.locator('.payinv__order')).toHaveText(en['pay.inv.order.fulfilled'], { timeout: 30_000 });
  await noOverflow(page, 'status page paid');
  await shot(page, errors, 'invoice-paid', info.project.name);
  expect(errors).toEqual([]);
});

test('an expired invoice offers no address to pay', async ({ page, request }) => {
  const errors = collectErrors(page);
  const id = await order(page);
  await expect(page.locator('.payinv__address')).toBeVisible();
  expect((await request.post(`/api/pay/fake/expire/${id}`, { data: {} })).ok()).toBe(true);
  // The page's own button, not a reload: WebKit reports a request cut short by navigation as a console error.
  await page.getByRole('button', { name: en['crossing.check'] }).click();
  await expect(page.locator('.payinv__status')).toHaveText(en['pay.inv.status.expired']);
  await expect(page.locator('.payinv__box')).toHaveCount(0);
  await expect(page.locator('.payinv__address')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an unknown invoice says so', async ({ page }) => {
  await page.goto(`/pay/i/${'0'.repeat(32)}`);
  await expect(page.getByRole('alert')).toHaveText(en['pay.inv.missing']);
});

test('the example page loads pay.js and its button opens the status page in a new tab', async ({ page, context }) => {
  const errors = collectErrors(page);
  await page.goto('/pay/example.html');
  const [tab] = await Promise.all([context.waitForEvent('page'), page.getByRole('button').click()]);
  await tab.waitForURL(/\/pay\/i\/[0-9a-f]{32}$/);
  await expect(tab.locator('.payinv__status')).toHaveText(en['pay.inv.status.open']);
  expect(errors).toEqual([]);
});

test('no Pay page overflows at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/pay');
  await expect(page.locator('.payshop__title')).toBeVisible();
  await noOverflow(page, '/pay at 320');
  const id = await order(page);
  await expect(page.locator('.payinv__address')).toBeVisible();
  await noOverflow(page, `/pay/i/${id} at 320`);
});
