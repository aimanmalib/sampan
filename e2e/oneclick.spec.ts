// The 1Click row of "Choose a route" (ADR 0050) against the fake server with features.oneClick on and the synthetic
// 1Click fake behind it (playwright.config.ts ONECLICK_PORT_OFFSET). The page asks only its own server, which asks
// 1Click; with the flag off (the cross-chain server) the page sends no 1Click request and names no 1Click anywhere.
// Skipped against a live site.
import { expect, test, type Page, type Request } from '@playwright/test';
import shipped from '../config/sampan.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };
import { ONECLICK_PORT_OFFSET } from '../playwright.config.js';
import { noHorizontalOverflow, primary, routeOn, routes, row, rowAmount, service, watch } from './atom-fake.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

const base = Number(process.env.E2E_PORT ?? 4173);
const ocUrl = `http://127.0.0.1:${base + ONECLICK_PORT_OFFSET}`;
const offUrl = `http://127.0.0.1:${base + 2}`;
const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const BCH_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const ROUTE = en['route.near-intents'];

/** True for a quote request the page made for the 1Click route. */
const ocQuote = (path: string) => (r: Request) => r.url().endsWith(path) && r.method() === 'POST' && (r.postDataJSON() as { route?: string } | null)?.route === 'near-intents';

/** Every request body or URL that names the 1Click route. */
function ocRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    const text = `${r.url()} ${r.postData() ?? ''}`;
    if (/near-intents|oneclick|chaindefuser/i.test(text)) seen.push(text);
  });
  return seen;
}

test('Send out shows THORChain, the atomic swap and 1Click for the same amount; 1Click is chosen by keyboard', async ({ page }) => {
  const seen = watch(page);
  await routeOn(page);
  await service(page);
  await page.goto(ocUrl);
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  const quoted = page.waitForResponse((r) => ocQuote('/api/out/quote')(r.request()) && r.ok());
  await page.locator('.out .field__input').first().fill('2');
  await page.getByPlaceholder('0x…').fill(DEST);
  await quoted;

  await expect(routes(page)).toBeVisible();
  await expect(routes(page).locator('.routes__row')).toHaveCount(3);
  await expect(row(page, 'thorchain').getByRole('radio')).toBeChecked();
  const oc = row(page, 'near-intents');
  await expect(oc).toContainText(ROUTE);
  await expect(oc).toContainText(rowAmount('[0-9]+\\.[0-9]{2}', 'USDC'));
  await expect(oc).toContainText(en['compare.time.none']);
  await expect(oc).toContainText(en['compare.time.estimateRoute'].replace('{route}', ROUTE).replace('{minutes}', '2'));
  await oc.locator('summary').click();
  await expect(oc).toContainText(en['compare.trust.deposit'].replace('{minutes}', String(shipped.oneClick.deadlineMinutes.out)));
  // Exactly one row carries the label, whichever receives the most.
  await expect(routes(page).locator('.routes__more')).toHaveCount(1);
  await expect(primary(page)).toHaveText(en['wallet.connect']);

  await row(page, 'thorchain').getByRole('radio').focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'atom').getByRole('radio')).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(oc.getByRole('radio')).toBeChecked();
  // The panel now reads the 1Click quote: the button is the crossing's own again, behind the wallet connection.
  await expect(primary(page)).toHaveText(en['wallet.connect']);
  await expect(page.locator('.out .swap__receive')).toContainText(/You receive about [0-9.]+ USDC/);
  await expect(page.locator('.out .card__note')).toBeVisible();
  // The cost card reads the same 1Click quote (USDC in its own 6 decimals): what it says arrives matches the row.
  const about = (await oc.locator('.routes__receive').innerText()).match(/(?:about|keep) ([0-9]+\.[0-9]{2})/)![1]!;
  // The row cuts to two decimals, the card rounds to the nearest cent (as for THORChain): within one cent.
  const card = (await page.locator('.cost__pay').innerText()).match(/receive about USD ([0-9]+\.[0-9]{2})/)![1]!;
  expect(Math.abs(Math.round(Number(card) * 100) - Math.round(Number(about) * 100))).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 320, height: 640 });
  await routes(page).scrollIntoViewIfNeeded();
  await noHorizontalOverflow(page);
  // Console first: a WebKit screenshot injects a style element that the page's CSP refuses (a capture artifact).
  expect(seen.errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath(`sampan-oc-card-out-${test.info().project.name}.png`), fullPage: true });
});

test('Bring in to BCH shows the 1Click row next to THORChain and keeps THORChain selected', async ({ page }) => {
  const seen = watch(page);
  await page.goto(ocUrl);
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.getByRole('radio', { name: en['in.receiveAs'].replace('{asset}', 'BCH') }).click();
  const quoted = page.waitForResponse((r) => ocQuote('/api/in/quote')(r.request()) && r.ok());
  await page.locator('.in .field__input').first().fill('5');
  await page.getByPlaceholder('bitcoincash:…').fill(BCH_ADDRESS);
  await quoted;
  await expect(routes(page).locator('.routes__row')).toHaveCount(2);
  await expect(row(page, 'thorchain').getByRole('radio')).toBeChecked();
  await expect(row(page, 'near-intents')).toContainText(rowAmount('[0-9.]+', 'BCH'));
  await row(page, 'near-intents').getByRole('radio').check();
  await expect(row(page, 'near-intents').getByRole('radio')).toBeChecked();
  // Without an EVM wallet there is nothing to sign with: the button waits.
  await expect(primary(page)).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 640 });
  await routes(page).scrollIntoViewIfNeeded();
  await noHorizontalOverflow(page);
  // Console first: a WebKit screenshot injects a style element that the page's CSP refuses (a capture artifact).
  expect(seen.errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath(`sampan-oc-card-in-${test.info().project.name}.png`), fullPage: true });
});

test('a refused 1Click quote is shown with its reason and cannot be chosen', async ({ page }) => {
  const seen = watch(page);
  await page.goto(ocUrl);
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  const refused = page.waitForResponse((r) => ocQuote('/api/out/quote')(r.request()) && r.status() === 400);
  await page.locator('.out .field__input').first().fill('0.3');
  await page.getByPlaceholder('0x…').fill(DEST);
  await refused;
  const oc = row(page, 'near-intents');
  await expect(oc).toContainText(en['compare.reason.routeMin'].replace('{route}', ROUTE));
  await expect(oc.getByRole('radio')).toBeDisabled();
  await expect(row(page, 'thorchain').getByRole('radio')).toBeChecked();
  // The refused quotes answer HTTP 400 (the API's contract); the browser logs that status line itself.
  expect(seen.errors.filter((e) => !/status of 400/.test(e))).toEqual([]);
});

test('with the flag off the page sends no 1Click request and names no 1Click', async ({ page }) => {
  const seen = watch(page);
  const oc = ocRequests(page);
  await page.goto(offUrl);
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await page.getByPlaceholder('0x…').fill(DEST);
  await expect(page.locator('.out .swap__receive')).toContainText(/You receive about [0-9.]+ USDC/, { timeout: 10_000 });
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.locator('.in .field__input').first().fill('5');
  await page.getByPlaceholder('bitcoincash:…').fill(BCH_ADDRESS);
  await expect(page.locator('.in .swap__receive')).toContainText(/[0-9]/, { timeout: 10_000 });
  await expect(routes(page)).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(ROUTE);
  expect(oc).toEqual([]);
  expect(seen.errors).toEqual([]);
});
