// /slides (features.slides, K5P5): the event deck as full-screen slides from the PDF's slide text. Arrow keys, the
// buttons and a sideways swipe change the slide and #n in the address opens slide n; the slide fits an iPhone 13 held
// either way with no sideways or downward scroll; nothing is asked from another origin (the demo video element exists
// only after its play button is pressed); the last slide links the PDF; the console stays clean. The flag is on only on the landing fake server; on the
// main one the address follows the shipped flag (404 page while it is off).
import { expect, test, type Page } from '@playwright/test';
import shipped from '../config/sampan.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };
import { TEMPLATE_TITLES } from '../tools/deck/content.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake servers');

const port = Number(process.env.E2E_PORT ?? 4173);
const landing = `http://127.0.0.1:${port + 1}`;
const main = `http://127.0.0.1:${port}`;

interface Watch {
  errors: string[];
  outside: string[];
}

function watch(page: Page): Watch {
  const w: Watch = { errors: [], outside: [] };
  page.on('console', (m) => m.type() === 'error' && w.errors.push(m.text()));
  page.on('pageerror', (e) => w.errors.push(e.message));
  page.on('request', (r) => {
    // blob: URLs carry their page's origin (WebKit hands fonts over as blobs); data: URLs have none.
    if (!r.url().startsWith('data:') && new URL(r.url()).origin !== landing) w.outside.push(r.url());
  });
  return w;
}

const shown = (page: Page) => page.locator('.slides [data-slide]');

async function swipe(page: Page, dx: number): Promise<void> {
  await page.locator('.slides__area').evaluate((el, d) => {
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const x = r.left + r.width / 2;
    const at = (type: string, cx: number) =>
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
    at('pointerdown', x);
    at('pointermove', x + d / 2);
    at('pointerup', x + d);
  }, dx);
}

async function fits(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await expect(shown(page)).toBeVisible();
  // The slide is rescaled when the area's ResizeObserver reports; wait for the new fit, not a fixed time. Check the
  // height too: the frame's max-width clamps a stale width at once, so width alone can pass while the old height stays.
  await expect.poll(() => page.evaluate(() => {
    const area = document.querySelector('.slides__area')!.getBoundingClientRect();
    const frame = document.querySelector('.slides__frame')!.getBoundingClientRect();
    const w = Math.min(area.width, (area.height * 1280) / 720);
    return Math.abs(frame.width - w) < 1.5 && Math.abs(frame.height - (w * 720) / 1280) < 1.5;
  })).toBe(true);
  const m = await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const de = document.documentElement;
    return { sw: de.scrollWidth, cw: de.clientWidth, sh: de.scrollHeight, ch: de.clientHeight, frame: box('.slides__frame'), bar: box('.slides__bar'), clip: (() => { const s = document.querySelector('.slides .slide')!; return s.scrollHeight - s.clientHeight; })() };
  });
  expect(m.sw).toBeLessThanOrEqual(m.cw);
  expect(m.sh).toBeLessThanOrEqual(m.ch);
  expect(m.frame.left).toBeGreaterThanOrEqual(0);
  expect(m.frame.right).toBeLessThanOrEqual(width + 0.5);
  expect(m.frame.bottom).toBeLessThanOrEqual(m.bar.top + 0.5);
  expect(m.bar.bottom).toBeLessThanOrEqual(height + 0.5);
  expect(m.frame.width).toBeGreaterThan(width * 0.5);
  expect(m.clip, 'slide text runs past the slide').toBeLessThanOrEqual(1);
}

test('arrow keys and the buttons move through the eight slides in the template order, #n follows', async ({ page }) => {
  const w = watch(page);
  await page.goto(`${landing}/slides`);
  await expect(shown(page)).toHaveAttribute('data-slide', '1');
  await expect(page.locator('.slides h1')).toHaveText(TEMPLATE_TITLES[0]);
  await expect(page.locator('#banner .banner, .topbar')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(shown(page)).toHaveAttribute('data-slide', '2');
  await expect(page).toHaveURL(/#2$/);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.slides h1')).toHaveText(TEMPLATE_TITLES[2]);
  await page.keyboard.press('ArrowLeft');
  await expect(shown(page)).toHaveAttribute('data-slide', '2');
  await page.getByRole('button', { name: en['slides.next'] }).click();
  await expect(shown(page)).toHaveAttribute('data-slide', '3');
  await page.getByRole('button', { name: en['slides.prev'] }).click();
  await expect(shown(page)).toHaveAttribute('data-slide', '2');
  await page.keyboard.press('End');
  await expect(shown(page)).toHaveAttribute('data-slide', String(TEMPLATE_TITLES.length));
  await expect(page.locator('.slides h1')).toHaveText(String(TEMPLATE_TITLES.at(-1)));
  await expect(page.getByRole('button', { name: en['slides.next'] })).toBeDisabled();
  await expect(page.locator('.slides .foot a', { hasText: en['slides.pdf'] })).toHaveAttribute('href', shipped.banner.deckPdfUrl);
  await expect(page.locator('.slides__pos')).toContainText(`${TEMPLATE_TITLES.length} / ${TEMPLATE_TITLES.length}`);
  const full = await page.evaluate(() => document.fullscreenEnabled === true);
  await expect(page.getByRole('button', { name: en['slides.fullscreen'] })).toHaveCount(full ? 1 : 0);
  expect(w.outside).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('#3 opens "Try it in a minute" with the demo media, and nothing loads from another origin', async ({ page }) => {
  const w = watch(page);
  await page.goto(`${landing}/slides#3`);
  await expect(shown(page)).toHaveAttribute('data-slide', '3');
  await expect(page.locator('.slides h1')).toHaveText('Try it in a minute');
  if (!shipped.features.demo) {
    await expect(page.getByRole('img', { name: en['slides.shot'] })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(w.outside).toEqual([]);
    expect(w.errors).toEqual([]);
    return;
  }
  const play = page.getByRole('button', { name: en['slides.video'] });
  await expect(play).toBeVisible();
  await expect(page.locator('[data-slides-video]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  expect(w.outside).toEqual([]);
  expect(w.errors).toEqual([]);
  // Pressed: the video element appears with the media host's one minute cut (the host itself is not asked here).
  await page.route(`https://${shipped.media.host}/**`, (route) => route.abort());
  await play.click();
  await expect(page.locator('[data-slides-video]')).toHaveAttribute('src', shipped.demo.video);
});

test('a sideways swipe changes the slide; a short or upward one does not', async ({ page }) => {
  const w = watch(page);
  await page.goto(`${landing}/slides`);
  await expect(shown(page)).toHaveAttribute('data-slide', '1');
  await swipe(page, -160);
  await expect(shown(page)).toHaveAttribute('data-slide', '2');
  await swipe(page, -160);
  await expect(shown(page)).toHaveAttribute('data-slide', '3');
  await swipe(page, 160);
  await expect(shown(page)).toHaveAttribute('data-slide', '2');
  await swipe(page, -(shipped.ui.slideSwipePx - 10));
  await expect(shown(page)).toHaveAttribute('data-slide', '2');
  expect(w.errors).toEqual([]);
});

test('every slide fits an iPhone 13 held upright and sideways, and 320 px, with no scroll', async ({ page }) => {
  const w = watch(page);
  await page.goto(`${landing}/slides`);
  for (let n = 1; n <= TEMPLATE_TITLES.length; n++) {
    await page.goto(`${landing}/slides#${n}`);
    await expect(shown(page)).toHaveAttribute('data-slide', String(n));
    await fits(page, 390, 664);
    await fits(page, 844, 390);
  }
  await fits(page, 320, 568);
  expect(w.errors).toEqual([]);
});

test('on the main fake server /slides follows the shipped flag', async ({ page }) => {
  const res = await page.goto(`${main}/slides`);
  expect(res?.status()).toBe(shipped.features.slides ? 200 : 404);
});
