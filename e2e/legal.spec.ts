import { expect, test } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };

// Runs against the fake server, or against the live site (E2E_BASE_URL, deploy/deploy.sh).
type Section = { key: string; cross?: boolean };
type Cfg = { compliance: { crossChainEnabled: boolean }; route: { active: string; symbols: string[] }; legal: Record<'terms' | 'risks', Section[]> };
const text = en as Record<string, string>;

for (const kind of ['terms', 'risks'] as const) {
  test(`/${kind} is linked from the footer and shows its sections in both languages`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('link', { name: text[`footer.${kind}`]!, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${kind}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(text[`legal.${kind}.title`]!);
    const cfg = (await (await page.request.get('/api/config')).json()) as Cfg;
    const cross = cfg.compliance.crossChainEnabled && cfg.route.active !== 'none' && cfg.route.symbols.length > 0;
    const shown = cfg.legal[kind].filter((s) => !s.cross || cross);
    await expect(page.locator('.legal__item h2')).toHaveText(shown.map((s) => text[`${kind}.${s.key}.title`]!));
    if (kind === 'risks') await expect(page.locator('.legal__funds')).toHaveCount(shown.length);
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await page.getByRole('combobox', { name: en['lang.label'] }).selectOption('ms');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText((ms as Record<string, string>)[`legal.${kind}.title`]!);
    expect(errors).toEqual([]);
  });
}

test('/terms names the operator and fits a 320 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/terms');
  const cfg = (await (await page.request.get('/api/config')).json()) as { legal: { operator: string } };
  await expect(page.locator('#operator')).toContainText(cfg.legal.operator);
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
});

test('/risks says how small an arrival is too small to give back, with the amount from config', async ({ page }) => {
  await page.goto('/risks');
  const cfg = (await (await page.request.get('/api/config')).json()) as { landing: { dustSats: number } };
  const funds = page.locator('#price .legal__funds');
  await expect(funds).toContainText(`${cfg.landing.dustSats.toLocaleString('en-US')} sat`);
  await expect(page.locator('.legal')).not.toContainText('{');
});

test.describe('with crossings to other chains open', () => {
  test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the local fake server with crossings on');
  test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + 2}` });

  test('/risks and /terms add the route and token approval sections', async ({ page }) => {
    const cfg = (await (await page.request.get('/api/config')).json()) as Cfg;
    await page.goto('/risks');
    await expect(page.locator('.legal__item')).toHaveCount(cfg.legal.risks.length);
    await expect(page.locator('#approval h2')).toHaveText(text['risks.approval.title']!);
    await expect(page.locator('#route')).toContainText(text[`route.${cfg.route.active}`]!);
    await page.goto('/terms');
    await expect(page.locator('.legal__item')).toHaveCount(cfg.legal.terms.length);
  });
});
