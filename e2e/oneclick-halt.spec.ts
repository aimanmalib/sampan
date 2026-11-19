// 1Click does not wait on THORChain's halt report (KSG3, ADR 0063), against the fake server with features.oneClick
// on (playwright.config.ts ONECLICK_PORT_OFFSET). The page's /api/health answer is rewritten so THORChain reports
// Ethereum and Base halted (its whole route paused): the tabs still show their form, Ethereum is offered through
// 1Click, the page sends THORChain no quote request, and the 1Click row can be chosen. Skipped against a live site.
import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { ONECLICK_PORT_OFFSET } from '../playwright.config.js';
import { primary, routes, row, rowAmount, watch } from './atom-fake.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

const ocUrl = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + ONECLICK_PORT_OFFSET}`;
const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const BCH_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const ETH_OUT = en['out.toAsset'].replace('{symbol}', 'USDC').replace('{chain}', 'Ethereum');

/** THORChain as the health check would report it with Ethereum and Base halted: no live chain open = route paused. */
async function thorHalted(page: Page): Promise<void> {
  await page.route('**/api/health', async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { route: { open: boolean | null; chains?: Record<string, boolean> | null } | null };
    body.route = { ...body.route!, open: false, chains: { ...(body.route?.chains ?? {}), BCH: true, ETH: false, BASE: false } };
    await route.fulfill({ response: res, json: body });
  });
}

/** Quote requests the page sends, split by route. */
function quotes(page: Page): { thor: string[]; oc: string[] } {
  const seen = { thor: [] as string[], oc: [] as string[] };
  page.on('request', (r: Request) => {
    if (r.method() !== 'POST' || !/\/api\/(out|in)\/quote$/.test(new URL(r.url()).pathname)) return;
    const body = r.postDataJSON() as { route?: string; chain?: string };
    (body.route === 'near-intents' ? seen.oc : seen.thor).push(`${body.chain}`);
  });
  return seen;
}

test('Send out: THORChain halted on Ethereum and Base, 1Click still quotes Ethereum and can be chosen', async ({ page }) => {
  const seen = watch(page);
  const asked = quotes(page);
  await thorHalted(page);
  await page.goto(ocUrl);
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await expect(page.locator('[data-paused="route"]')).toHaveCount(0);
  const eth = page.locator('.network__row', { hasText: ETH_OUT });
  await expect(eth).toBeVisible();
  await eth.locator('input').check();
  const quoted = page.waitForResponse(
    (r) => r.url().endsWith('/api/out/quote') && (r.request().postDataJSON() as { route?: string; chain?: string }).chain === 'ETH' && r.ok(),
  );
  await page.locator('.out .field__input').first().fill('2');
  await page.getByPlaceholder('0x…').fill(DEST);
  expect((await quoted).request().postDataJSON()).toMatchObject({ route: 'near-intents', chain: 'ETH' });

  const oc = row(page, 'near-intents');
  await expect(routes(page)).toBeVisible();
  await expect(oc).toContainText(rowAmount('[0-9]+\\.[0-9]{2}', 'USDC'));
  await oc.getByRole('radio').check();
  await expect(oc.getByRole('radio')).toBeChecked();
  await expect(primary(page)).toHaveText(en['wallet.connect']);
  // THORChain was never asked: it reports every network this panel offers halted.
  expect(asked.thor).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test('Bring in: THORChain halted, 1Click still quotes Ethereum; the tab is not "Paused by the route"', async ({ page }) => {
  const seen = watch(page);
  const asked = quotes(page);
  await thorHalted(page);
  await page.goto(ocUrl);
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  const cross = page.locator('.in__sources [role="radio"]').last();
  if (await cross.count()) await cross.click();
  await expect(page.locator('[data-paused="route"]')).toHaveCount(0);
  const quoted = page.waitForResponse((r) => r.url().endsWith('/api/in/quote') && r.ok());
  await page.locator('.in .field__input').first().fill('2');
  await page.getByPlaceholder('bitcoincash:…').fill(BCH_ADDRESS);
  expect((await quoted).request().postDataJSON()).toMatchObject({ route: 'near-intents' });
  await expect(row(page, 'near-intents')).toContainText(rowAmount('[0-9.]+', '[A-Z]+'));
  expect(asked.thor).toEqual([]);
  expect(seen.errors).toEqual([]);
});
