import { expect, test } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { measuredHeadline } from '../scripts/measured-json.js';

// The front page Measured line names wallets outside the team only once there is at least one swap, landing or crossing
// by them. /api/stats is answered here so the check runs the same on the fake server and on the live site.
const counts = (c: Record<string, number>) => ({ completed: 0, swaps: 0, returned: 0, lost: 0, medianSeconds: null, ...c });
const outside = en['measured.public'].replace(/\s*\{p\}\s*/, '').trim();

for (const [label, pub, shown] of [
  ['zero', counts({}), null],
  ['one swap', counts({ swaps: 1 }), '1'],
] as const) {
  test(`Measured line with ${label} outside the team`, async ({ page }) => {
    await page.route('**/api/stats', (route) =>
      route.fulfill({ json: { all: counts({ completed: 3, swaps: 2 }), test: counts({ completed: 3, swaps: 1 }), public: pub } }),
    );
    await page.goto('/');
    const line = page.locator('.measured__line');
    await expect(line).toContainText('3 landings and crossings completed');
    if (shown === null) await expect(line).not.toContainText(outside);
    else await expect(line).toContainText(en['measured.public'].replace('{p}', shown));
  });
}

// measured.source "proof" (shipped): the headline is the count of docs/MEASURED.md made by the README bounty counter,
// with this server's records as the small line below and a link to every transaction on /how.
test('Measured card shows the counted MEASURED headline, also at 320 px', async ({ page }) => {
  const head = measuredHeadline();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const card = page.locator('.measured__headline');
  await expect(card).toContainText(en['measured.headline'].split('{crossings}')[1]!.split('{chains}')[0]!.trim());
  await expect(card).toHaveAttribute('data-crossings', String(head.crossings));
  await expect(card).toContainText(new RegExp(`^${head.crossings} `));
  await expect(card).toContainText(en['measured.txids'].replace('{n}', String(head.txids)));
  if (head.bothWays.length === 0) await expect(card).not.toContainText(en['measured.bothWays'].split(' {')[0]!);
  await expect(page.getByRole('link', { name: en['measured.see'] })).toHaveAttribute('href', '/how#proof');
  // The fake server has completed nothing: under the proof headline its line stays away rather than show a 0.
  await expect(page.locator('.measured__line')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 640 });
  await card.scrollIntoViewIfNeeded();
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
  const box = await card.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  expect(errors).toEqual([]);
});
