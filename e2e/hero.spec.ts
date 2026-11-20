// The front page's top with ui.hero "card" (K5P2, ADR 0078), on the fake server with the shipped config: one headline
// and the whole action card on the first screen, live status chips, and a price that refreshes itself every
// quote.autoRefreshMs ("Updated Ns ago" changes with no click) and stops asking while the tab is hidden.
// Time is Playwright's fake clock, never a sleep.
import { expect, test, type Page } from '@playwright/test';
import shipped from '../config/sampan.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };
import { SHIPPED_PORT_OFFSET } from '../playwright.config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server with the shipped config');
test.skip(shipped.ui.hero !== 'card' || shipped.quote.autoRefreshMs === 0, 'the shipped config has the card hero with refreshing prices');
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + SHIPPED_PORT_OFFSET}` });

const REFRESH = shipped.quote.autoRefreshMs;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Counts the swap quote requests the page sends. */
function quoteCount(page: Page): () => number {
  let n = 0;
  page.on('request', (r) => r.url().endsWith('/api/swap/quote') && r.method() === 'POST' && (n += 1));
  return () => n;
}

async function inView(page: Page, selector: string): Promise<void> {
  const height = page.viewportSize()!.height;
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${selector} is laid out`).not.toBeNull();
  expect(box!.y, `${selector} top`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${selector} bottom at ${height}px`).toBeLessThanOrEqual(height);
}

test('the first screen is the headline, the status chips and the whole card, with no filter in the hero', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText(en['hero.title']);
  await expect(page.locator('.swap__receive')).toContainText(/\d/, { timeout: 10_000 });
  await expect(page.locator('.quote-age')).toBeVisible();
  const chips = page.getByRole('list', { name: en['hero.chips.label'] });
  await expect(chips.locator('[data-chip=pools]')).toContainText(/\d/);
  for (const selector of ['h1', 'section.card', '.button--primary']) await inView(page, selector);
  // A wide screen has room for the chips beside the card; a phone shows them right under it.
  if (test.info().project.name.includes('desktop')) await inView(page, '.hero__chips');
  else await expect(chips).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // The longer sentence sits under the card in this hero.
  const order = await page.evaluate(() => {
    const card = document.querySelector('section.card')!;
    const sub = document.querySelector('.hero__sub');
    return sub ? card.compareDocumentPosition(sub) & Node.DOCUMENT_POSITION_FOLLOWING : -1;
  });
  expect(order).toBeGreaterThan(0);
  const effects = await page.evaluate(() =>
    [...document.querySelectorAll('.hero, .hero *')].map((el) => {
      const s = getComputedStyle(el);
      return `${s.filter}|${s.getPropertyValue('backdrop-filter') || 'none'}|${s.getPropertyValue('-webkit-backdrop-filter') || 'none'}`;
    }),
  );
  expect(effects.filter((e) => e !== 'none|none|none')).toEqual([]);
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client!);
  expect(errors).toEqual([]);
});

test('the price refreshes itself, "Updated" changes with no click, and nothing is asked while the tab is hidden', async ({ page }) => {
  const errors = collectErrors(page);
  const asked = quoteCount(page);
  await page.clock.install();
  await page.goto('/');
  const age = page.locator('.quote-age');
  const ageText = age.locator('[aria-hidden=true]');
  await expect(age).toBeVisible({ timeout: 10_000 });
  const first = asked();

  // The count goes up by itself, then a new price arrives and it starts again.
  const firstAt = await age.getAttribute('data-quote-at');
  await page.clock.runFor(2_000);
  await expect(ageText).toHaveText(new RegExp(`^${en['quote.updated'].replace('{seconds}', '[1-9][0-9]*')}$`));
  await page.clock.runFor(REFRESH);
  await expect.poll(asked).toBeGreaterThan(first);
  await expect(age).not.toHaveAttribute('data-quote-at', firstAt!);
  await expect(page.locator('.quote-age [aria-live=polite]')).toHaveText(/\S/);

  // A hidden tab asks nothing, however long it stays hidden.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenAt = asked();
  await page.clock.runFor(REFRESH * 3);
  expect(asked()).toBe(hiddenAt);

  // Back on the tab: a price older than one period asks at once.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(asked).toBeGreaterThan(hiddenAt);
  await expect(page.getByRole('button', { name: /refresh/i })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an open dialog holds the price still', async ({ page }) => {
  const asked = quoteCount(page);
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('.quote-age')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => {
    const d = document.createElement('dialog');
    d.id = 'probe';
    document.body.append(d);
    d.showModal();
  });
  const openAt = asked();
  await page.clock.runFor(REFRESH * 2);
  expect(asked()).toBe(openAt);
  await page.evaluate(() => (document.getElementById('probe') as HTMLDialogElement).close());
  await page.clock.runFor(REFRESH);
  await expect.poll(asked).toBeGreaterThan(openAt);
});
