import { expect, test } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };

// /faq: every question in config.faq.items is asked, with its answer filled from config, then the custody steps.
// Runs against the fake server, or against the live site (E2E_BASE_URL, deploy/deploy.sh).
type Cfg = {
  compliance: { crossChainEnabled: boolean };
  route: { active: string; symbols: string[] };
  faq: { items: string[]; custody: { key: string; cross?: boolean }[] };
};
const text = en as Record<string, string>;
const crossOpen = (c: Cfg): boolean => c.compliance.crossChainEnabled && c.route.active !== 'none' && c.route.symbols.length > 0;

test('/faq is linked from the footer and /how, asks every listed question and lists who holds the funds', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: text['footer.faq']!, exact: true }).click();
  await expect(page).toHaveURL(/\/faq$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(text['faq.title']!);
  const cfg = (await (await page.request.get('/api/config')).json()) as Cfg;
  expect(cfg.faq.items.length).toBeGreaterThanOrEqual(6);
  await expect(page.locator('.legal__item h2')).toHaveCount(cfg.faq.items.length);
  for (const item of cfg.faq.items) {
    await expect(page.locator(`#${item} h2`)).toBeVisible();
    await expect(page.locator(`#${item} p`)).not.toBeEmpty();
  }
  await expect(page.locator('#faq-hold-title')).toHaveText(text['faq.hold.title']!);
  const steps = cfg.faq.custody.filter((s) => !s.cross || crossOpen(cfg));
  await expect(page.locator('.faq__step h3')).toHaveText(steps.map((s) => text[`faq.hold.${s.key}.title`]!));
  // Every placeholder is filled from config.
  await expect(page.locator('.faq')).not.toContainText('{');
  await page.getByRole('combobox', { name: en['lang.label'] }).selectOption('ms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ms['faq.title']);
  await expect(page.locator('#faq-hold-title')).toHaveText(ms['faq.hold.title']);
  await page.goto('/how');
  await page.locator('.how__faq a').click();
  await expect(page).toHaveURL(/\/faq$/);
  expect(errors).toEqual([]);
});

test('/faq fits a 320 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/faq');
  await expect(page.locator('.faq__step').first()).toBeVisible();
  await page.locator('.faq__more').scrollIntoViewIfNeeded();
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
});
