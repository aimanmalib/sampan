// One halted chain pauses that chain only (KSG6, ADR 0064), against the network fake server (Ethereum, BNB Smart Chain
// and Base live there only; playwright.config.ts NETWORK_PORT_OFFSET). The page's /api/health answer is rewritten so
// THORChain reports Ethereum and Base halted and BNB Smart Chain open: both halted chains stay listed, marked "Paused
// by THORChain" with their radio off, BNB Smart Chain is picked, quoted and costed; with every chain halted the tab
// lists each chain with its state instead of an empty panel; a chain that reopens comes back without a reload.
// Skipped against a live site.
import { expect, test, type Page, type Route } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { NETWORK_PORT_OFFSET } from '../playwright.config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + NETWORK_PORT_OFFSET}` });

const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const BCH_ADDRESS = 'bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt';
const PAUSED_TEXT = en['cross.network.paused'].replace('{route}', en['route.thorchain']);
const name = (symbol: string, chain: string): string => en['out.toAsset'].replace('{symbol}', symbol).replace('{chain}', chain);
const ETH = name('USDC', 'Ethereum');
const BASE = name('USDC', 'Base');
const BSC = name('USDC', 'BNB Smart Chain');

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Rewrites every /api/health answer with THORChain's open state per chain from `chains()` (read on each answer). */
async function thorChains(page: Page, chains: () => Record<string, boolean>): Promise<void> {
  await page.route('**/api/health', async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { route: { open: boolean | null; chains?: Record<string, boolean> | null } | null };
    const next = { ...(body.route?.chains ?? {}), BCH: true, ...chains() };
    const open = next['BCH'] === true && Object.entries(next).some(([k, v]) => k !== 'BCH' && v);
    body.route = { ...body.route!, open, chains: next };
    await route.fulfill({ response: res, json: body });
  });
}

const network = (page: Page, text: string) => page.getByRole('group', { name: en['cross.network'] }).locator('.network__row', { hasText: text });

async function expectPaused(page: Page, text: string): Promise<void> {
  const row = network(page, text);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-status', 'paused');
  await expect(row).toContainText(PAUSED_TEXT);
  await expect(row.getByRole('radio')).toBeDisabled();
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
}

test('Send out: Ethereum and Base halted stay listed as paused; BNB Smart Chain is picked, quoted and costed', async ({ page }) => {
  const errors = collectErrors(page);
  await thorChains(page, () => ({ ETH: false, BASE: false, BSC: true }));
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  await expect(page.locator('[data-paused="route"]')).toHaveCount(0);
  await expectPaused(page, ETH);
  await expectPaused(page, BASE);
  const bsc = network(page, BSC);
  await expect(bsc).toHaveAttribute('data-status', 'open');
  await expect(bsc.getByRole('radio')).toBeChecked();

  const quoted = page.waitForResponse((r) => r.url().endsWith('/api/out/quote') && (r.request().postDataJSON() as { chain?: string }).chain === 'BSC' && r.ok());
  await page.getByPlaceholder('0x…').fill(DEST);
  await quoted;
  await expect(page.locator('.swap__receive')).toContainText(/You receive about [0-9.]+ USDC/, { timeout: 10_000 });
  await expect(page.getByTestId('cost-card')).toBeVisible();

  await page.setViewportSize({ width: 320, height: 640 });
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('Bring in: the same chains are paused, BNB Smart Chain is quoted', async ({ page }) => {
  const errors = collectErrors(page);
  await thorChains(page, () => ({ ETH: false, BASE: false, BSC: true }));
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  await page.locator('.in__sources [role="radio"]').last().click();
  await expectPaused(page, ETH);
  await expectPaused(page, BASE);
  await expect(network(page, BSC).getByRole('radio')).toBeChecked();
  const asked = page.waitForRequest((r) => r.url().endsWith('/api/in/quote') && (r.postDataJSON() as { chain?: string }).chain === 'BSC');
  await page.getByPlaceholder('bitcoincash:…').fill(BCH_ADDRESS);
  await page.locator('.in .field__input').first().fill('5');
  await asked;
  expect(errors).toEqual([]);
});

test('Every chain halted: the tab lists each chain paused, then a chain reopens without a reload', async ({ page }) => {
  const errors = collectErrors(page);
  let chains: Record<string, boolean> = { ETH: false, BASE: false, BSC: false };
  await thorChains(page, () => chains);
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  const paused = page.locator('[data-paused="route"]');
  await expect(paused).toBeVisible();
  await expect(paused.locator('.paused__chain')).toHaveCount(4);
  for (const text of [ETH, BASE, BSC]) {
    const item = paused.locator('.paused__chain', { hasText: text }).first();
    await expect(item).toHaveAttribute('data-status', 'paused');
    await expect(item).toContainText(PAUSED_TEXT);
  }
  await expect(paused).toContainText(/every [0-9]+ seconds/);
  await page.setViewportSize({ width: 320, height: 640 });
  await noHorizontalOverflow(page);

  // BNB Smart Chain reopens: the next health answer (asked again when the tab becomes visible) brings the form back.
  chains = { ETH: false, BASE: false, BSC: true };
  const next = page.waitForResponse((r) => r.url().endsWith('/api/health'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await next;
  await expect(paused).toHaveCount(0);
  await expect(network(page, BSC).getByRole('radio')).toBeChecked();
  await expectPaused(page, ETH);
  expect(errors).toEqual([]);
});
