import { expect, test } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import fil from '../lang/fil.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import { ONECLICK_PORT_OFFSET } from '../playwright.config.js';

// Runs against the fake server, or against the live site (E2E_BASE_URL, deploy/deploy.sh).
type Section = { key: string; cross?: boolean; oneClick?: boolean; list?: string[]; verbatim?: string };
type Cfg = {
  compliance: { crossChainEnabled: boolean };
  features: { oneClick: boolean };
  route: { active: string; symbols: string[] };
  legal: Record<'terms' | 'risks', Section[]>;
};
const shownOf = (cfg: Cfg, kind: 'terms' | 'risks') => {
  const cross = cfg.compliance.crossChainEnabled && cfg.route.active !== 'none' && cfg.route.symbols.length > 0;
  return cfg.legal[kind].filter((s) => (!s.cross || cross) && (!s.oneClick || cfg.features.oneClick));
};
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
    const shown = shownOf(cfg, kind);
    await expect(page.locator('.legal__item h2')).toHaveText(shown.map((s) => text[`${kind}.${s.key}.title`]!));
    if (kind === 'risks') await expect(page.locator('.legal__funds')).toHaveCount(shown.length);
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await page.getByRole('combobox', { name: en['lang.label'] }).selectOption('ms');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText((ms as Record<string, string>)[`legal.${kind}.title`]!);
    await expect(page.getByText(ms['legal.translation'], { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('a software translation says so in the footer and that English applies on /terms; English says neither', async ({ page }) => {
  await page.goto('/terms');
  await expect(page.getByText(en['legal.translation'], { exact: true })).toHaveCount(0);
  await expect(page.getByText(en['lang.machine'], { exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: en['lang.label'] }).selectOption('fil');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(fil['legal.terms.title']);
  await expect(page.getByText(fil['legal.translation'], { exact: true })).toBeVisible();
  await expect(page.getByRole('contentinfo').getByText(fil['lang.machine'], { exact: true })).toBeVisible();
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
});

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
    await expect(page.locator('.legal__item')).toHaveCount(shownOf(cfg, 'risks').length);
    await expect(page.locator('#approval h2')).toHaveText(text['risks.approval.title']!);
    await expect(page.locator('#route')).toContainText(text[`route.${cfg.route.active}`]!);
    await page.goto('/terms');
    await expect(page.locator('.legal__item')).toHaveCount(shownOf(cfg, 'terms').length);
    await expect(page.locator('#oneclick')).toHaveCount(0);
    await expect(page.locator('.legal')).not.toContainText('Intents Technology');
  });
});

test.describe('with the 1Click route on', () => {
  test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the local fake server with features.oneClick on');
  test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + ONECLICK_PORT_OFFSET}` });

  test('/terms shows the 1Click section with the UK words in English in every language, and /risks its risk', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    const cfg = (await (await page.request.get('/api/config')).json()) as Cfg & { legal: { operator: string } };
    expect(cfg.features.oneClick).toBe(true);
    const section = cfg.legal.terms.find((s) => s.key === 'oneclick')!;
    const uk = text[`terms.oneclick.${section.verbatim}`]!;
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/terms');
    await expect(page.locator('#operator')).toContainText(cfg.legal.operator);
    await expect(page.locator('#oneclick h2')).toHaveText(text['terms.oneclick.title']!);
    await expect(page.locator('#oneclick .legal__points li')).toHaveCount(section.list!.length);
    await expect(page.locator('#oneclick .legal__verbatim')).toHaveText(uk);
    await expect(page.locator('#oneclick .legal__verbatim-translation')).toHaveCount(0);
    for (const [code, dict] of [['ms', ms], ['fil', fil]] as const) {
      await page.getByRole('combobox', { name: en['lang.label'] }).selectOption(code);
      await expect(page.locator('#oneclick h2')).toHaveText((dict as Record<string, string>)['terms.oneclick.title']!);
      await expect(page.locator('#oneclick .legal__verbatim')).toHaveText(uk);
      await expect(page.locator('#oneclick .legal__verbatim')).toHaveAttribute('lang', 'en');
      await expect(page.locator('#oneclick .legal__verbatim-translation')).toContainText((dict as Record<string, string>)['terms.oneclick.uk']!);
      await page.getByRole('combobox', { name: (dict as Record<string, string>)['lang.label'] }).selectOption('en');
    }
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await page.goto('/risks');
    await expect(page.locator('#oneclick h2')).toHaveText(text['risks.oneclick.title']!);
    await expect(page.locator('#oneclick .legal__funds')).toContainText(text['risks.oneclick.funds']!);
    expect(errors).toEqual([]);
  });
});
