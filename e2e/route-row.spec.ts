// "Choose a route": the whole row picks its route (ADR 0093), not only the 44 px label line. Against the fake server
// with 1Click on (three rows in Send out), Chromium desktop and WebKit iPhone 13. Skipped against a live site.
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { ONECLICK_PORT_OFFSET } from '../playwright.config.js';
import { noHorizontalOverflow, routeOn, routes, row, service, watch } from './atom-fake.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

const base = Number(process.env.E2E_PORT ?? 4173);
const ocUrl = `http://127.0.0.1:${base + ONECLICK_PORT_OFFSET}`;
const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';

/** True for the page's 1Click quote request in Send out. */
const ocQuote = (r: Request) => r.url().endsWith('/api/out/quote') && r.method() === 'POST' && (r.postDataJSON() as { route?: string } | null)?.route === 'near-intents';

/** Opens Send out on the 1Click fake and waits for the 1Click answer and the route card for `amount`. */
async function openRoutes(page: Page, amount: string): Promise<void> {
  await page.goto(ocUrl);
  await page.getByRole('tab', { name: en['tabs.out'] }).click();
  const answered = page.waitForResponse((r) => ocQuote(r.request()));
  await page.locator('.out .field__input').first().fill(amount);
  await page.getByPlaceholder('0x…').fill(DEST);
  await answered;
  await expect(routes(page)).toBeVisible();
}

/** Page points inside a row: its centre, and 8 px above its bottom edge (both at the horizontal centre). */
async function points(target: Locator): Promise<{ centre: [number, number]; bottom: [number, number] }> {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  return { centre: [x, box.y + box.height / 2], bottom: [x, box.y + box.height - 8] };
}

/** The computed cursor of whatever element is on top at a viewport point. */
const cursorAt = (page: Page, [x, y]: [number, number]) =>
  page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px!, py!);
    return el ? getComputedStyle(el).cursor : null;
  }, [x, y]);

test('a click anywhere on a route row picks it; "How" still opens its own details', async ({ page }) => {
  const seen = watch(page);
  await routeOn(page);
  await service(page);
  await openRoutes(page, '2');
  await expect(routes(page).locator('.routes__row')).toHaveCount(3);
  await expect(row(page, 'thorchain').getByRole('radio')).toBeChecked();
  const oc = row(page, 'near-intents');
  await expect(oc.getByRole('radio')).toBeEnabled();

  // The row is far taller than its label line: the bottom point is outside the label's own box.
  const p = await points(oc);
  const label = (await oc.locator('.routes__pick > input').boundingBox())!;
  expect(p.bottom[1]).toBeGreaterThan(label.y + label.height + 20);

  expect(await cursorAt(page, p.bottom)).toBe('pointer');
  await page.mouse.click(...p.bottom);
  await expect(oc.getByRole('radio')).toBeChecked();

  const atom = row(page, 'atom');
  const a = await points(atom);
  expect(await cursorAt(page, a.centre)).toBe('pointer');
  await page.mouse.click(...a.centre);
  await expect(atom.getByRole('radio')).toBeChecked();
  await expect(oc.getByRole('radio')).not.toBeChecked();

  // The summary sits above the row-wide label: it opens the details and leaves the choice alone.
  const how = row(page, 'thorchain').locator('details.routes__how');
  await how.locator('summary').click();
  await expect(how).toHaveAttribute('open', '');
  await expect(atom.getByRole('radio')).toBeChecked();

  await page.setViewportSize({ width: 320, height: 640 });
  await routes(page).scrollIntoViewIfNeeded();
  await noHorizontalOverflow(page);
  const t = await points(row(page, 'thorchain'));
  await page.mouse.click(...t.bottom);
  await expect(row(page, 'thorchain').getByRole('radio')).toBeChecked();
  expect(seen.errors).toEqual([]);
});

test('a row that is off is not picked by a click on it, and shows a not-allowed cursor', async ({ page }) => {
  await openRoutes(page, '0.3');
  const oc = row(page, 'near-intents');
  await expect(oc).toHaveClass(/routes__row--off/);
  await expect(oc.getByRole('radio')).toBeDisabled();
  const p = await points(oc);
  expect(await cursorAt(page, p.centre)).toBe('not-allowed');
  await page.mouse.click(...p.centre);
  await page.mouse.click(...p.bottom);
  await expect(oc.getByRole('radio')).not.toBeChecked();
  await expect(row(page, 'thorchain').getByRole('radio')).toBeChecked();
});
