// One recorded take: a fresh browser context with Playwright's recordVideo, the corner clock, and marks (milliseconds
// from the start of the clip) that the edit uses to cut and caption. The clip is renamed to <scene>-<engine>.webm.
import { mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { chromium, devices, webkit, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { CLIPBOARD_SPY } from '../measure/server.js';
import { CLOCK_OVERLAY, type Mark, type Scene } from './shots.js';

export const ENGINES = ['chromium-desktop', 'webkit-iphone13'] as const;
export type Engine = (typeof ENGINES)[number];

const iphone = devices['iPhone 13'];
const CONTEXTS: Record<Engine, { launch: () => Promise<Browser>; options: BrowserContextOptions }> = {
  'chromium-desktop': { launch: () => chromium.launch(), options: { viewport: { width: 1920, height: 1080 }, recordVideo: { dir: '', size: { width: 1920, height: 1080 } } } },
  'webkit-iphone13': {
    launch: () => webkit.launch(),
    options: { ...iphone, recordVideo: { dir: '', size: { width: iphone.viewport.width * 2, height: iphone.viewport.height * 2 } } },
  },
};

export interface Take {
  page: Page;
  engine: Engine;
  mark(what: string): void;
  /** Waits on purpose, so the viewer can read what is on screen. */
  dwell(ms: number): Promise<void>;
  /** Scrolls an element into the middle of the screen in small steps, the way a person scrolls. */
  glide(selector: string): Promise<void>;
  /** Scrolls down by about this many pixels in small steps. */
  drift(px: number): Promise<void>;
}

export interface TakeResult {
  clip: string;
  startUtc: string;
  endUtc: string;
  marks: Mark[];
}

export async function recordTake<T>(dir: string, scene: Scene, engine: Engine, run: (take: Take) => Promise<T>, init: string[] = []): Promise<TakeResult & { value: T }> {
  const raw = path.join(dir, 'raw');
  mkdirSync(raw, { recursive: true });
  const { launch, options } = CONTEXTS[engine];
  const browser = await launch();
  const context = await browser.newContext({ ...options, recordVideo: { ...options.recordVideo!, dir: raw } });
  await context.addInitScript(CLIPBOARD_SPY);
  await context.addInitScript(CLOCK_OVERLAY);
  for (const s of init) await context.addInitScript(s);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const started = Date.now();
  const marks: Mark[] = [];
  const take: Take = {
    page,
    engine,
    mark: (what) => {
      marks.push({ at: Date.now() - started, what });
      console.log(`${scene}/${engine} +${((Date.now() - started) / 1000).toFixed(1)} s ${what}`);
    },
    dwell: (ms) => page.waitForTimeout(ms),
    glide: async (selector) => {
      // window.scrollBy rather than the mouse wheel: mobile WebKit has no wheel. Stops at the end of the page.
      for (let i = 0; i < 80; i++) {
        const box = await page.locator(selector).first().boundingBox();
        const view = page.viewportSize()!;
        if (!box) break;
        const off = box.y + Math.min(box.height, view.height) / 2 - view.height / 2;
        if (Math.abs(off) < 30) break;
        const before = Number(await page.evaluate('window.scrollY'));
        await page.evaluate(`window.scrollBy(0, ${Math.sign(off) * Math.min(Math.abs(off), Math.max(60, Math.abs(off) / 6))})`);
        await page.waitForTimeout(40);
        if (Number(await page.evaluate('window.scrollY')) === before) break;
      }
    },
    drift: async (px) => {
      for (let done = 0; done < px; done += 40) {
        await page.evaluate('window.scrollBy(0, 40)');
        await page.waitForTimeout(40);
      }
    },
  };
  try {
    const value = await run(take);
    const endUtc = new Date().toISOString();
    const video = page.video();
    await context.close();
    const clip = `${scene}-${engine}.webm`;
    if (video) renameSync(await video.path(), path.join(dir, clip));
    return { clip, startUtc: new Date(started).toISOString(), endUtc, marks, value };
  } finally {
    await browser.close();
  }
}
