// No blank screen (KPJ3), against one fake server per SAMPAN_FAKE_OUTAGE mode (playwright.config.ts): whatever fails,
// the headline is in view, the page has readable text that says what is wrong, and no error goes uncaught.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { OUTAGE_MODES } from '../playwright.config';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake servers with outages switched on');
const portOf = (mode: (typeof OUTAGE_MODES)[number]) => Number(process.env.E2E_PORT ?? 4173) + 3 + OUTAGE_MODES.indexOf(mode);

/** Opens the page on the server for `mode`, collecting errors nothing caught. */
async function open(page: Page, mode: (typeof OUTAGE_MODES)[number]): Promise<string[]> {
  const uncaught: string[] = [];
  page.on('pageerror', (e) => uncaught.push(e.message));
  await page.goto(`http://127.0.0.1:${portOf(mode)}/`);
  await expect(page.locator('h1')).toHaveText(en['hero.title']);
  await expect(page.locator('h1')).toBeInViewport();
  return uncaught;
}

async function bodyText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).trim();
}

/** Nothing wider than the screen, also at 320 px; with E2E_SHOTS_DIR set, saves the first screen for review. */
async function fits(page: Page, name: string, project: string): Promise<void> {
  for (const width of [page.viewportSize()!.width, 320]) {
    await page.setViewportSize({ width, height: page.viewportSize()!.height });
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll, `${name} at ${width}px`).toBeLessThanOrEqual(client!);
  }
  const dir = process.env.E2E_SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/sampan-outage-${name}-${project}.png`, fullPage: true });
}

test('indexer down: the card names Cauldron as not answering', async ({ page }, info) => {
  const uncaught = await open(page, 'indexer');
  await expect(page.locator('.provider-note')).toContainText(en['health.cauldron'], { timeout: 15_000 });
  expect(await bodyText(page)).not.toBe('');
  await fits(page, 'indexer', info.project.name);
  expect(uncaught).toEqual([]);
});

test('Bitcoin Cash servers down: the card names Bitcoin Cash as not answering', async ({ page }, info) => {
  const uncaught = await open(page, 'electrum');
  await expect(page.locator('.provider-note')).toContainText(en['health.bch'], { timeout: 15_000 });
  await fits(page, 'electrum', info.project.name);
  expect(uncaught).toEqual([]);
});

test('API down: the page says the server is not answering', async ({ page }, info) => {
  const uncaught = await open(page, 'api');
  await expect(page.locator('.server-down')).toHaveText(en['error.server']);
  await fits(page, 'api', info.project.name);
  expect(uncaught).toEqual([]);
});

test('scripts fail to load: the static headline and line in the page stay', async ({ page }, info) => {
  const uncaught = await open(page, 'chunk');
  await expect(page.locator('.boot')).toHaveText(en['boot.text']);
  await fits(page, 'chunk', info.project.name);
  expect(uncaught).toEqual([]);
});

test('one tab breaks: the error card stands in that tab, the rest of the page stays', async ({ page }, info) => {
  const uncaught = await open(page, 'render');
  await expect(page.locator('#tab-panel .crash')).toBeVisible();
  await expect(page.locator('#tab-panel .crash__title')).toHaveText(en['error.title']);
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('figure.scene')).toBeVisible();
  await expect(page.getByRole('button', { name: en['error.reload'] })).toBeVisible();
  await fits(page, 'render', info.project.name);
  expect(uncaught).toEqual([]);
});
