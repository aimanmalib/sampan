import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import type { RouteFacts } from '../core/route-facts.js';

// K6P5: the card's line and the /how table are read from docs/route-facts.json (built into the page), so every route
// there has a row, and the swap tab's line names its measured runs. Fake server or the live site (E2E_BASE_URL).
const landingPort = Number(process.env.E2E_PORT ?? 4173) + 1;
test.use({ baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${landingPort}` });
const facts = JSON.parse(readFileSync(new URL('../docs/route-facts.json', import.meta.url), 'utf8')) as RouteFacts;
const swap = facts.routes.find((r) => r.id === 'swap');

test('the swap tab shows its measured line under the button, linked to the table on /how', async ({ page }) => {
  test.skip(!swap?.time, 'no measured swap route in docs/route-facts.json');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const line = page.locator('[data-route-fact=swap]');
  await expect(line).toBeVisible();
  // The footer row form: the short label says the time was measured and the fee quoted, with the runs counted and the
  // quote time in the link's accessible name.
  await expect(line.getByRole('link')).toHaveText(swap!.fees['20'].usd === null ? en['facts.measuredShort'] : en['facts.shortBoth']);
  if (swap!.fees['20'].usd !== null) await expect(line).toContainText(en['facts.quotedShort']);
  await expect(line.getByRole('link')).toHaveAttribute('aria-label', new RegExp(en['facts.measured'].replace('{n}', String(swap!.time!.n))));
  // It sits in the Fees row, so the card is no taller: the line's box is inside the row's box.
  const [row, box] = await Promise.all([page.locator('.swap__foot').boundingBox(), line.boundingBox()]);
  expect(box!.y).toBeGreaterThanOrEqual(row!.y);
  expect(box!.y + box!.height).toBeLessThanOrEqual(row!.y + row!.height + 0.5);
  await expect(page.locator('.button--primary')).toHaveCount(1);
  await line.getByRole('link').click();
  await expect(page).toHaveURL(/\/how#route-facts$/);
  await expect(page.getByRole('heading', { name: en['facts.title'] })).toBeVisible();
  expect(errors).toEqual([]);
});

test('/how lists every route of docs/route-facts.json without sideways scroll at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/how');
  const rows = page.locator('#route-facts tbody tr');
  await expect(rows).toHaveCount(facts.routes.length);
  for (const r of facts.routes) await expect(page.locator(`#route-facts tr[data-route-fact="${r.id}"]`)).toHaveCount(1);
  await page.locator('#route-facts').scrollIntoViewIfNeeded();
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
  // With E2E_SHOTS_DIR set, saves the table for review.
  const dir = process.env.E2E_SHOTS_DIR;
  if (dir) await page.locator('#route-facts').screenshot({ path: `${dir}/sampan-route-facts-320-${test.info().project.name}.png` });
});
