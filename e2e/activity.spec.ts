// "My activity" (/activity, ADR 0076) against the fake landing server: a pasted txid that is not 64 hex digits is
// refused in the page, one THORChain has not seen is not found, one it has seen links to the THORChain explorer;
// with the fake wallet connected the page sends only that wallet's addresses and lists the landing opened for it,
// linked to its status page. No sideways scroll and no console error. Skipped against a live site.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

const landingPort = Number(process.env.E2E_PORT ?? 4173) + 1;
test.use({ baseURL: `http://127.0.0.1:${landingPort}` });

// The fake THORNode has seen every txid except those ending in 00 (server/routes/fake.ts).
const SEEN = 'ab'.repeat(32);
const UNSEEN = `${'cd'.repeat(31)}00`;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function noOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
}

async function find(page: Page, txid: string): Promise<void> {
  await page.getByLabel(en['activity.find.label']).fill(txid);
  await page.getByRole('button', { name: en['activity.find.go'] }).click();
}

test('find a transaction: refused, not found, seen by THORChain', async ({ page }) => {
  const errors = collectErrors(page);
  const cfg = (await (await page.request.get('/api/config')).json()) as { routeExplorerTxUrl: string };
  await page.goto('/activity');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['activity.title']);
  await find(page, 'abc123');
  await expect(page.getByRole('alert')).toHaveText(en['activity.find.bad']);
  const before = errors.length;
  const answer = page.waitForResponse((r) => r.url().endsWith(`/api/lookup/${UNSEEN}`));
  await find(page, `0x${UNSEEN}`);
  expect((await answer).status()).toBe(404);
  await expect(page.getByRole('alert')).toHaveText(en['activity.find.notFound']);
  // The browser logs the 404 answer itself as a failed load; that one line is the answer this step expects.
  expect(errors.splice(before).every((e) => /status of 404/.test(e))).toBe(true);
  await find(page, SEEN);
  await expect(page.getByRole('link', { name: en['activity.find.open'] })).toHaveAttribute('href', cfg.routeExplorerTxUrl.replace('{txid}', SEEN));
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('connected wallet: only its addresses are sent and its landing is listed', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  const cfg = (await (await page.request.get('/api/config')).json()) as { defaultToken: string };
  await page.goto('/activity');
  await expect(page.locator('[data-activity="idle"]')).toBeVisible();
  const first = page.waitForRequest((r) => r.url().endsWith('/api/activity') && r.method() === 'POST');
  await page.getByRole('button', { name: en['wallet.connect'] }).click();
  const addresses = ((await first).postDataJSON() as { addresses: string[] }).addresses;
  expect(addresses.length).toBeGreaterThan(0);
  expect(addresses.every((a) => a.startsWith('bitcoincash:'))).toBe(true);
  await expect(page.locator('[data-activity="ok"]')).toBeVisible();

  const owner = addresses.find((a) => a.startsWith('bitcoincash:z'))!;
  const opened = await page.request.post('/api/land/open', { data: { ownerAddress: owner, token: cfg.defaultToken } });
  expect(opened.ok()).toBe(true);
  const { crossingId } = (await opened.json()) as { crossingId: string };

  await page.reload();
  await page.getByRole('button', { name: en['wallet.connect'] }).click();
  const row = page.locator(`a.activity__link[href="/c/${crossingId}"]`);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.locator('.activity__kind')).toHaveText(en['crossing.kind.land']);
  await expect(row.locator('.activity__state')).toHaveText(en['activity.state.open']);
  await noOverflow(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await noOverflow(page);
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/c/${crossingId}$`));
  expect(errors).toEqual([]);
});
