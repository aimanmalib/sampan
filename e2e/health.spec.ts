// The status line above the footer (the server's own health check) and "Paused by the route": when the last check
// saw the route halted, the cross-chain forms give way to the paused note while the landing address stays usable.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

const live = Boolean(process.env.E2E_BASE_URL);
const outPort = Number(process.env.E2E_PORT ?? 4173) + 2;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
}

test('the status line names Cauldron and Bitcoin Cash with their state', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const line = page.getByLabel(en['health.label']);
  await expect(line.locator('[data-health="cauldron"]')).toContainText(en['health.cauldron']);
  await expect(line.locator('[data-health="bch"]')).toContainText(en['health.bch']);
  expect(errors).toEqual([]);
});

test.describe('with crossings on', () => {
  test.skip(live, 'needs the fake server');
  test.use({ baseURL: `http://127.0.0.1:${outPort}` });

  test('lists the route as ok while the fake route is open', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-health="route"]')).toHaveText(`${en['route.thorchain']} ${en['health.ok']}`);
  });

  test('shows "Paused by the route" on both cross-chain forms when the route is halted, at 320 px too', async ({ page }) => {
    const errors = collectErrors(page);
    await page.route('**/api/health', (r) =>
      r.fulfill({ json: { checkedAt: Date.now(), cauldron: true, bch: true, height: 900000, route: { id: 'thorchain', open: false } } }),
    );
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/');
    await expect(page.locator('[data-health="route"]')).toHaveText(`${en['route.thorchain']} ${en['health.halted']}`);
    await page.getByRole('tab', { name: en['tabs.out'] }).click();
    await expect(page.locator('[data-paused="route"]')).toContainText(en['paused.route.title']);
    await expect(page.getByPlaceholder('0x…')).toHaveCount(0);
    await noHorizontalOverflow(page);
    await page.getByRole('tab', { name: en['tabs.in'] }).click();
    const radios = page.locator('.in__sources [role="radio"]');
    if ((await radios.count()) > 1) await radios.nth(1).click();
    await expect(page.locator('[data-paused="route"]')).toBeVisible();
    await noHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
