// "See a finished crossing" (site.finished): Send out and Bring in each link to one measured crossing,
// and its page shows the BCH and the other chain's transaction ids as docs/MEASURED.md records them, with explorer
// links and the measured time, in two languages and without overflow. Runs against the fake server with the shipped
// config, or against the live site (E2E_BASE_URL).
import { expect, test } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import { finishedCrossing } from '../core/proof.js';
import { SHIPPED_PORT_OFFSET } from '../playwright.config.js';
import { measuredJson } from '../scripts/measured-json.js';

const shippedPort = Number(process.env.E2E_PORT ?? 4173) + SHIPPED_PORT_OFFSET;
test.use({ baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${shippedPort}` });

interface Cfg {
  site: { finished: { out: string; in: string } };
  compliance: { crossChainEnabled: boolean };
  connect: { explorerTxUrl: string };
}

for (const flow of ['out', 'in'] as const) {
  test(`${flow}: the tab links to a finished crossing whose page shows both chains' transactions`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    const cfg = (await (await page.request.get('/api/config')).json()) as Cfg;
    const run = finishedCrossing(measuredJson(), flow, cfg.site.finished[flow]);
    test.skip(!cfg.compliance.crossChainEnabled || !run, 'no crossing named for this direction');
    await page.goto('/');
    await page.getByRole('tab', { name: en[flow === 'out' ? 'tabs.out' : 'tabs.in'] }).click();
    const link = page.getByRole('link', { name: en['done.link'] });
    await expect(link).toHaveAttribute('href', `/done/${cfg.site.finished[flow]}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/done/${cfg.site.finished[flow]}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['done.title']);
    await expect(page.locator(`[data-done="${flow}"]`)).toBeVisible();
    for (const x of run!.txids) {
      const a = page.locator(`.done__facts a[href*="${x.id}"]`);
      await expect(a).toHaveText(x.id);
      await expect(a).toHaveAttribute('data-chain', x.chain);
    }
    expect(run!.txids.some((x) => x.chain !== 'bch')).toBe(true);
    await expect(page.locator(`.done__facts a[data-chain="bch"]`).first()).toHaveAttribute(
      'href',
      cfg.connect.explorerTxUrl.replace('{txid}', run!.txids[0]!.id),
    );
    await expect(page.locator('[data-seconds]')).toHaveAttribute('data-seconds', String(run!.seconds));
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await page.getByRole('combobox', { name: en['lang.label'] }).selectOption('ms');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ms['done.title']);
    expect(errors).toEqual([]);
  });
}

test('an id the measurements do not hold shows a plain note, not a crossing', async ({ page }) => {
  await page.goto(`/done/${'0'.repeat(64)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['done.title']);
  await expect(page.getByText(en['done.missing'])).toBeVisible();
  await expect(page.locator('.done__facts')).toHaveCount(0);
});
