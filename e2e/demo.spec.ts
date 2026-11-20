// /demo (ADR 0082, features.demo): the browser's own player with the video from this site and a subtitle track per page
// language; every chapter lists full transaction ids that open in an explorer, and its button moves the video to the
// chapter's start. Footer, banner and /how link to it. No sideways scroll at 320 px and no console error. Runs on the
// local server and against the live site.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import shipped from '../config/sampan.json' with { type: 'json' };
import chapterFile from '../docs/demo/chapters.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };

test.skip(!shipped.features.demo, 'features.demo is off');

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const noOverflow = async (page: Page): Promise<void> => {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
};

test('chapters list their transactions and move the video', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/demo');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['demo.title']);
  const video = page.locator('[data-demo-video]');
  await expect(video.locator('source')).toHaveAttribute('src', shipped.demo.video);
  await expect(video.locator('track')).toHaveCount(shipped.i18n.languages.length);
  await expect(video.locator('track[default]')).toHaveAttribute('srclang', 'en');

  const chapters = page.locator('[data-chapter]');
  await expect(chapters).toHaveCount(chapterFile.chapters.length);
  for (const c of chapterFile.chapters) {
    const item = page.locator(`[data-chapter="${c.id}"]`);
    const title = en[c.titleKey as keyof typeof en].replace(/\{(\w+)\}/g, (m, k: string) => (chapterFile.vars as Record<string, string>)[k] ?? m);
    await expect(item.getByRole('button')).toContainText(title);
    const first = item.locator('[data-txid]').first();
    await expect(first).toHaveText(c.txids[0]!);
    expect(await first.getAttribute('href')).toContain(c.txids[0]!);
    await expect(item.locator('[data-txid]')).toHaveCount(Math.min(c.txids.length, shipped.demo.txidsShown));
    if (c.receipt) await expect(item.getByRole('link', { name: en['demo.receipt'] })).toHaveAttribute('href', c.receipt);
  }

  // A chapter after the first moves the player to its start (the video keeps playing or pauses: only the time is checked).
  const target = chapterFile.chapters[2]!;
  await page.locator(`[data-chapter="${target.id}"] button`).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThanOrEqual(target.start - 0.5);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('the video answers a range request, as a player asks for it', async ({ page }) => {
  const res = await page.request.get(shipped.demo.video, { headers: { Range: 'bytes=0-1023' } });
  expect(res.status()).toBe(206);
  expect(res.headers()['content-type']).toContain('video/mp4');
  for (const { code } of shipped.i18n.languages) {
    const t = await page.request.get(shipped.demo.video.replace(/\.mp4$/, `.${code}.vtt`));
    expect(t.status()).toBe(200);
    expect((await t.text()).startsWith('WEBVTT')).toBe(true);
  }
});

test('linked from the banner, the footer and /how', async ({ page }) => {
  await page.goto('/how');
  await expect(page.getByRole('link', { name: en['how.demo'] })).toHaveAttribute('href', '/demo');
  await expect(page.locator('.banner__lead a[href="/demo"]')).toHaveText(en['banner.demo']);
  await expect(page.locator('footer a[href="/demo"]')).toHaveText(en['footer.demo']);
});

test('320 px wide: no sideways scroll, no axe failure', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/demo');
  await expect(page.locator('[data-chapter]').first()).toBeVisible();
  await noOverflow(page);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});
