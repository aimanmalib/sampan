// Accessibility on every page a visitor reaches without a wallet, and in the connect dialog: no WCAG 2.1 A or AA
// failures found by axe (contrast included), every control at least --touch (44 px) tall and wide on a phone and
// 24 px (WCAG 2.2 target size, AA) with a mouse, and a visible focus ring when the keyboard reaches a control. Runs locally and against the live site (deploy/deploy.sh).
import AxeBuilder from '@axe-core/playwright';
import { encodeLockingBytecodeP2pkh, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

const PAGES = ['/', '/how', '/terms', '/risks'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
/** Controls a finger has to hit. Links inside running text are exempt (WCAG 2.5.8 "inline"). */
const CONTROLS = 'button, select, input:not([type=hidden]), textarea, summary, [role=tab], a:not(p a):not(li a):not(td a)';

async function axeClean(page: Page, include?: string): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder.include(include);
  const { violations } = await builder.analyze();
  const report = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(report).toEqual([]);
}

/** Pointer target floor with a mouse (WCAG 2.2 SC 2.5.8). */
const MOUSE_MIN = 24;

async function smallTargets(page: Page, scope: string, isMobile: boolean): Promise<string[]> {
  return page.locator(scope).evaluate((root, { selector, touch, mouseMin }) => {
    const min = touch ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--touch')) : mouseMin;
    return [...root.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.height < min - 0.5 || r.width < min - 0.5))
      .map(({ el, r }) => `${el.tagName.toLowerCase()}.${el.className} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  }, { selector: CONTROLS, touch: isMobile, mouseMin: MOUSE_MIN });
}

for (const path of PAGES) {
  test(`${path}: no WCAG AA failures, targets large enough to hit`, async ({ page, isMobile }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await axeClean(page);
    expect(await smallTargets(page, 'body', isMobile)).toEqual([]);
  });
}

test('the keyboard reaches the primary button with a visible focus ring', async ({ page, browserName }) => {
  // WebKit moves Tab focus only to form fields unless the user turns on full keyboard access.
  test.skip(browserName === 'webkit', 'Safari tabs to links and buttons only with full keyboard access on');
  await page.goto('/');
  const primary = page.locator('.button--primary');
  await expect(primary).toBeVisible();
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    if (await primary.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(primary).toBeFocused();
  const ring = await primary.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);
});

test('the connect dialog has no WCAG AA failures and targets large enough to hit', async ({ page, isMobile }) => {
  // The fake server's wallet connects without a dialog; the real dialog shows only on a live site.
  test.skip(!process.env.E2E_BASE_URL, 'the connect dialog shows only against a live site');
  await page.goto('/');
  const primary = page.locator('.button--primary');
  await expect(primary).toHaveText(en['wallet.connect']);
  await primary.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await axeClean(page, '[role=dialog]');
  expect(await smallTargets(page, '[role=dialog]', isMobile)).toEqual([]);
});

test.describe('landing address panel and its status page', () => {
  // Second fake server from playwright.config.ts (port E2E_PORT + 1), started with the landing flow on.
  test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');
  test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + 1}` });

  test('no WCAG AA failures, targets large enough to hit', async ({ page, isMobile }) => {
    const owner = lockingBytecodeToCashAddress({ bytecode: encodeLockingBytecodeP2pkh(new Uint8Array(20).fill(0x22)), prefix: 'bitcoincash', tokenSupport: true });
    if (typeof owner === 'string') throw new Error(owner);
    await page.goto('/');
    await page.getByRole('tab', { name: en['tabs.in'] }).click();
    await page.getByRole('textbox').fill(owner.address);
    await page.locator('.button--primary').click();
    await expect(page.locator('.land__address')).toHaveText(/^bitcoincash:p/, { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await axeClean(page);
    expect(await smallTargets(page, 'body', isMobile)).toEqual([]);
    const follow = await page.getByRole('link', { name: en['land.follow'] }).getAttribute('href');
    await page.goto(follow!);
    await expect(page.locator('.crossing__status')).toBeVisible();
    await axeClean(page);
    expect(await smallTargets(page, 'body', isMobile)).toEqual([]);
  });
});
