import { expect, test } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

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
