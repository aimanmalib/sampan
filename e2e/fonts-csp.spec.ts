// The page's own fonts and its Content Security Policy (ADR 0055), in both engines.
// Fonts: the families the theme tokens name are served from the site itself, load, and the first screen fetches
// at most four font files. CSP: a visit produces no "Refused to" message and no securitypolicyviolation event.
// No page.screenshot() runs here: in WebKit a screenshot adds a <style> element of Playwright's own, which the
// policy refuses, so a test that took one would report Playwright's stylesheet, not the page's (see the ADR).
import { expect, test, type Page } from '@playwright/test';

const ID = 'c'.repeat(32);
const TX = 'cd'.repeat(32);
/** One finished swap, served for /c/<ID> so the status page renders a fixed state. */
const FIXTURE = { id: ID, kind: 'swap', status: 'done', asset: 'PUSD', txid: TX, createdAt: 1, updatedAt: 1 };
/** Most font files the first screen may fetch (PRD H6 page weight). */
const MAX_FIRST_SCREEN_FONT_FILES = 4;

/** Records every CSP refusal the page reports, from the console and from the DOM event. */
async function watchPolicy(page: Page): Promise<string[]> {
  const refused: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('Refused to')) refused.push(`console: ${m.text()}`);
  });
  await page.exposeFunction('sampanPolicyViolation', (text: string) => refused.push(`event: ${text}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { sampanPolicyViolation: (t: string) => void }).sampanPolicyViolation(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return refused;
}

test('the theme fonts come from the site itself and load on the first screen', async ({ page, baseURL }) => {
  const fontFiles: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fontFiles.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')),
      text: document.fonts.check('16px "IBM Plex Sans"'),
      display: document.fonts.check('600 16px "Fraunces"'),
    };
  });
  expect(fonts.loaded).toContain('IBM Plex Sans');
  expect(fonts.loaded).toContain('Fraunces');
  expect(fonts.text).toBe(true);
  expect(fonts.display).toBe(true);
  const origin = new URL(baseURL!).origin;
  expect(fontFiles.length).toBeGreaterThan(0);
  expect(fontFiles.filter((u) => new URL(u).origin !== origin)).toEqual([]);
  expect(fontFiles.every((u) => new URL(u).pathname.endsWith('.woff2'))).toBe(true);
  expect(fontFiles.length).toBeLessThanOrEqual(MAX_FIRST_SCREEN_FONT_FILES);
});

for (const path of ['/', '/how', `/c/${ID}`]) {
  test(`${path}: the Content Security Policy refuses nothing on a visit`, async ({ page }) => {
    const refused = await watchPolicy(page);
    await page.route(`**/api/crossings/${ID}**`, (route) => route.fulfill({ json: FIXTURE }));
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle');
    expect(refused).toEqual([]);
  });
}
