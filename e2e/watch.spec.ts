// "Watch it run" (/watch?dir=land, features.watchDemo): a replay of the measured landing run site.watch.land names,
// with no wallet and no transaction. On: three steps, each linking the real transaction in the explorer, the play
// money label, the honest pace line, done when the last step has played; with reduced motion every step shows at once;
// the judge box links to it. Off (the main fake server): no link, and the address is the 404 page.
// Needs the fake servers (the flag is on only on the landing one).
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { landRun } from '../core/proof.js';
import { measuredJson } from '../scripts/measured-json.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake servers');

const port = Number(process.env.E2E_PORT ?? 4173);
const landing = `http://127.0.0.1:${port + 1}`;
const main = `http://127.0.0.1:${port}`;

interface Cfg {
  site: { watch: { land: string } };
  connect: { explorerTxUrl: string };
}

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

async function shippedRun(page: Page) {
  const cfg = (await (await page.request.get(`${landing}/api/config`)).json()) as Cfg;
  const run = landRun(measuredJson(), cfg.site.watch.land);
  expect(run, 'site.watch.land names a measured landing run').not.toBeNull();
  return { cfg, run: run! };
}

test('on: three steps replay the measured run, each linking its real transaction, then the replay is done', async ({ page }) => {
  const errors = collectErrors(page);
  const { cfg, run } = await shippedRun(page);
  await page.goto(`${landing}/watch?dir=land`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['watch.title']);
  const section = page.locator('[data-watch="land"]');
  await expect(section).toHaveAttribute('data-motion', 'replay');
  await expect(page.getByText(en['watch.play'])).toBeVisible();
  const steps = page.locator('.watch__step');
  await expect(steps).toHaveCount(3);
  const href = cfg.connect.explorerTxUrl.replace('{txid}', run.txids[0]!.id);
  for (let i = 0; i < 3; i += 1) await expect(steps.nth(i).locator('a')).toHaveAttribute('href', href);
  // The steps are still playing right after load, and done follows the last step's animation end (an event).
  await expect(section).toHaveAttribute('data-done', 'true', { timeout: 15_000 });
  for (let i = 0; i < 3; i += 1) await expect(steps.nth(i)).toHaveCSS('opacity', '1');
  await expect(page.locator('.watch__clock')).toContainText(`${run.seconds!.toFixed(1)}`);
  await expect(page.locator('.watch__clock')).toHaveAttribute('data-pace', /^(faster|slower|same)$/);
  // Play again starts over.
  await page.getByRole('button', { name: en['watch.again'] }).click();
  await expect(section).toHaveAttribute('data-done', 'false');
  await expect(section).toHaveAttribute('data-done', 'true', { timeout: 15_000 });
  await page.setViewportSize({ width: 320, height: 640 });
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('on, reduced motion: every step shows at once and nothing animates', async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${landing}/watch?dir=land`);
  const section = page.locator('[data-watch="land"]');
  await expect(section).toHaveAttribute('data-motion', 'static');
  await expect(section).toHaveAttribute('data-done', 'true');
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  expect(running).toBe(0);
  for (let i = 0; i < 3; i += 1) await expect(page.locator('.watch__step').nth(i)).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});

test('on: the judge box links to the replay; an unknown direction is the not-found page', async ({ page }) => {
  await page.goto(`${landing}/`);
  await expect(page.locator('[data-watch-link]')).toHaveAttribute('href', '/watch?dir=land');
  await expect(page.locator('[data-watch-link]')).toHaveText(en['judge.watch']);
  await page.goto(`${landing}/watch?dir=sideways`);
  await expect(page.locator('[data-not-found]')).toContainText(en['error.page.notFound']);
  await expect(page.locator('[data-watch]')).toHaveCount(0);
});

test('off: no link in the judge box, and /watch is the 404 page', async ({ page }) => {
  const res = await page.request.get(`${main}/watch?dir=land`);
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain(en['error.page.notFound']);
  // The landing server with the flag switched off in the page's config: the judge box shows, without the link.
  await page.route('**/api/config', async (route) => {
    const r = await route.fetch();
    const body = (await r.json()) as { features: Record<string, boolean> };
    await route.fulfill({ response: r, json: { ...body, features: { ...body.features, watchDemo: false } } });
  });
  await page.goto(`${landing}/`);
  await expect(page.locator('.judge')).toHaveCount(1);
  await expect(page.locator('[data-watch-link]')).toHaveCount(0);
});
