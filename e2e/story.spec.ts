// The front page under the first screen (ADR 0094, web/src/front/), on the fake server with the shipped flows: how each
// open flow works beside the whole contract, what is open right now, the logbook of the newest runs of docs/MEASURED.md
// and the doors, with the first screen's rules still true (one primary button, no link to Sampan Pay in <main>). The
// top bar's section links show on a wide screen only. Text is compared with lang/en.json, numbers with config and
// MEASURED.md: nothing is typed here.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import shipped from '../config/sampan.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };
import { measuredJson } from '../scripts/measured-json.js';
import { SHIPPED_PORT_OFFSET } from '../playwright.config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server with the shipped flows');
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + SHIPPED_PORT_OFFSET}` });

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** The live site's health: the route open on every chain config lists (the fake server alone reports no open route). */
async function routeOpen(page: Page): Promise<void> {
  const chains = Object.fromEntries(['BCH', ...shipped.evm.chains.map((c) => c.key)].map((k) => [k, true]));
  await page.route('**/api/health', async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { route: Record<string, unknown> | null };
    body.route = { ...body.route, open: true, chains };
    await route.fulfill({ response: res, json: body });
  });
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client!);
}

test('under the card: the flows beside the whole contract, the logbook and the doors, and still one primary button', async ({ page }) => {
  const errors = collectErrors(page);
  const proof = measuredJson();
  await page.addInitScript(() => localStorage.setItem('sampan.lang', 'en'));
  await page.goto('/');
  const how = page.locator('#how');
  await expect(how.getByRole('heading', { level: 2 })).toHaveText(en['how.title']);
  await expect(how.getByText(en['how.lead'])).toBeVisible();
  // The shipped flags: swap and the landing address, each with its crossing drawn and the sentence /how gives it.
  await expect(how.getByRole('heading', { name: en['how.land.title'], exact: true })).toBeVisible();
  await expect(how.getByRole('heading', { name: en['how.swap.title'], exact: true })).toBeVisible();
  await expect(how.getByRole('list', { name: en['how.swap.title'] }).locator('.wake__stop')).toHaveCount(3);
  await expect(how.locator('.source__code')).toContainText('contract Landing(');
  await expect(how.locator('.source__code')).toContainText('function giveBack()');

  const log = page.locator('#measured');
  await expect(log.locator('.measured__headline')).toBeVisible();
  const rows = log.locator('.logbook__table tbody tr');
  await expect(rows).toHaveCount(Math.min(proof.runs.length, shipped.site.proofRuns));
  // Every id of the newest run opens in an explorer, in a new tab, with the whole id in its title.
  const newest = proof.runs[0]!;
  const links = rows.first().locator('a');
  await expect(links).toHaveCount(newest.txids.length);
  for (const [i, x] of newest.txids.entries()) {
    await expect(links.nth(i)).toHaveAttribute('title', x.id);
    await expect(links.nth(i)).toHaveAttribute('href', new RegExp(`^https://.+${x.id}$`));
    await expect(links.nth(i)).toHaveAttribute('target', '_blank');
  }
  await expect(log.getByText(en['proof.wallets'].replace('{n}', String(proof.wallets)))).toBeVisible();

  if (shipped.features.demo) await expect(page.locator('[data-door=demo] a')).toHaveAttribute('href', '/demo');
  if (shipped.features.pay) await expect(page.locator('[data-door=pay] a')).toHaveAttribute('href', '/pay');
  await expect(page.locator('[data-door=risks] a')).toHaveText(en['legal.risks.title']);
  // The first screen's rules hold with the longer page.
  await expect(page.locator('.button--primary')).toHaveCount(1);
  await expect(page.locator('main a[href^="/pay"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await noSidewaysScroll(page);
  expect(errors).toEqual([]);
});

test('right now: a lane for every chain a crossing reaches, with no WCAG AA failure', async ({ page }) => {
  await routeOpen(page);
  await page.addInitScript(() => localStorage.setItem('sampan.lang', 'en'));
  await page.goto('/');
  const now = page.locator('#now');
  await expect(now.getByRole('heading', { level: 2 })).toHaveText(en['hero.chips.label']);
  // The rows are the chains the hero chips name, in the same words.
  const chips = page.locator('.hero__chips [data-chip^=chain-]');
  await expect(chips.first()).toBeVisible();
  const names = await chips.allTextContents();
  await expect(now.locator('.board tbody tr')).toHaveCount(names.length);
  await expect(now.locator('.board__net > span:last-child')).toHaveText(names);
  // The cross-chain flow joins the two on-chain ones, with the first-crossing notice's sentences: who carries it and
  // what happens when the route cannot finish.
  const cross = page.locator('#how [data-flow=cross]');
  await expect(cross.getByRole('heading', { level: 3 })).toHaveText(en['how.cross.title']);
  await expect(cross.locator('.flow__text').first()).toContainText(en['disclose.route'].split('{route}')[1]!.trim());
  await expect(cross.locator('.flow__text').last()).toHaveText(en['disclose.final']);
  await now.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('#now').include('#how').analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  await noSidewaysScroll(page);
});

// The first server of playwright.config.ts has the 1Click route off (and crossings off): the page under the card names
// no route it does not offer, so a measured run carried by 1Click is not listed there (/how still lists every run).
test.describe('with the 1Click route off', () => {
  test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173)}` });

  test('the logbook lists no run carried by it, and no crossing between chains is drawn', async ({ page, request }) => {
    const served = (await (await request.get('/api/config')).json()) as { features: { oneClick: boolean }; site: { proofRuns: number } };
    expect(served.features.oneClick).toBe(false);
    const runs = measuredJson().runs.filter((r) => !r.flow.startsWith('oc-'));
    await page.addInitScript(() => localStorage.setItem('sampan.lang', 'en'));
    await page.goto('/');
    await expect(page.locator('#measured .logbook__table tbody tr')).toHaveCount(Math.min(runs.length, served.site.proofRuns));
    await expect(page.locator('#how')).toBeVisible();
    await expect(page.locator('#how [data-flow=cross]')).toHaveCount(0);
    await expect(page.locator('#now')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(en['route.near-intents']);
  });
});

test('the top bar links to the sections on a wide screen and stays as it was on a phone', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.locator('.topbar .brand')).toHaveAttribute('href', '/');
  await expect(page.locator('.topbar .wordmark')).toHaveText('Sampan');
  const link = page.locator('.topnav a[href="/#how"]');
  if (isMobile) {
    await expect(link).toBeHidden();
    return;
  }
  await expect(link).toHaveText(en['how.title']);
  await expect(page.locator('#how')).not.toBeInViewport();
  await link.click();
  await expect(page).toHaveURL(/\/#how$/);
  await expect(page.locator('#how').getByRole('heading', { level: 2 })).toBeInViewport();
});

test('a link to a section from another page lands on it', async ({ page }) => {
  // The sections are drawn after the config arrives, so the page itself scrolls to the one the address names.
  await page.goto('/#measured');
  await expect(page.locator('#measured .measured__title')).toBeInViewport();
});

test('no sideways scroll at 320 px down the whole page', async ({ page }) => {
  await routeOpen(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(page.locator('#measured .logbook__table')).toBeAttached();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await noSidewaysScroll(page);
  // The footer's picture and sentence fit the narrow screen too.
  const box = await page.locator('.footer__scene').boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
});
