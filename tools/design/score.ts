// Scores the three look directions (ADR 0057) on this host, each on the built server (dist/) with the real config,
// the real network (live quotes, no fakes) and config ui.theme patched to the direction's theme.
//   npx tsx tools/design/score.ts [--out state/rupa] [--port 4196] [--ask '<command with {png}>']
// Per direction it writes, under --out: <theme>-iphone13.png and <theme>-desktop.png (English, first screen), and one
// entry of skor.json: { A|B|C: { tema, aa, skrinPertama, limaSaat, perkataan, kaedah } }, then prints the order (rank.ts).
//   aa           axe colour-contrast finds nothing on / and /how, every config language, Chromium 1440x900 and
//                WebKit iPhone 13.
//   skrinPertama the first-screen rule (e2e/first-screen.spec.ts) holds on an iPhone 13 in every config language.
//   perkataan    words visible on the first iPhone 13 screen in English.
//   limaSaat     0 to 3. With --ask, the command (a fresh model session that has never seen the page) is run with {png}
//                replaced by the English iPhone screenshot; it answers QUESTIONS, one numbered line each, and each
//                line is checked against the page (answers kept in <theme>-answers.txt). Without --ask, a mechanical
//                proxy, the same for every direction: the primary button stands out most in the card, the amount is
//                the largest text in the card, at most 60 words on the first screen.
import AxeBuilder from '@axe-core/playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, devices, webkit, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import en from '../../lang/en.json' with { type: 'json' };
import { loadConfig } from '../../server/config.js';
import { startServer, waitHealthy } from '../measure/server.js';
import { LETTERS, rank, type DirectionScore, type Letter, type Scores } from './rank.js';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1]! : fallback;
};

/** The three directions, in tie-break order. */
export const DIRECTIONS: Record<Letter, string> = { A: 'night', B: 'linen', C: 'ink' };
export const QUESTIONS = ['What can you do on this page?', 'Which one button would you press first?', 'How much would you receive?'];
const PROXY_MAX_WORDS = 60;
const OUT = arg('--out', 'state/rupa');
const PORT = Number(arg('--port', '4196'));
const ASK = arg('--ask', '');
const FIRST_SCREEN = ['h1', 'figure.scene', '.judge__title', '.judge__fill', 'section.card', '[role=tablist]', '.button--primary'];
const QUOTE_TIMEOUT_MS = 20_000;

const config = loadConfig('config/sampan.json');
const LANGS = config.i18n.languages.map((l) => l.code);
type Engine = 'chromium-desktop' | 'webkit-iphone13';
const ENGINES: Record<Engine, { launch: () => Promise<Browser>; options: BrowserContextOptions }> = {
  'chromium-desktop': { launch: () => chromium.launch(), options: { viewport: { width: 1440, height: 900 } } },
  'webkit-iphone13': { launch: () => webkit.launch(), options: { ...devices['iPhone 13'] } },
};

async function open(browser: Browser, engine: Engine, base: string, lang: string, at: string): Promise<Page> {
  const context = await browser.newContext({ ...ENGINES[engine].options, baseURL: base });
  await context.addInitScript((value) => localStorage.setItem('sampan.lang', value), lang);
  const page = await context.newPage();
  await page.goto(at);
  await page.locator('h1').first().waitFor();
  if (at === '/') await page.locator('.swap__receive').filter({ hasText: /\d/ }).waitFor({ timeout: QUOTE_TIMEOUT_MS });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function contrastClean(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  return violations.flatMap((v) => v.nodes.map((n) => n.target.join(' ')));
}

/** The first-screen rule: every part fully in view, no scroll either way. Returns what failed. */
async function firstScreen(page: Page): Promise<string[]> {
  return page.evaluate((selectors) => {
    const h = window.innerHeight;
    const bad: string[] = [];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const r = el?.getBoundingClientRect();
      if (!r || r.height === 0) bad.push(`${sel} missing`);
      else if (r.top < 0 || r.bottom > h) bad.push(`${sel} ${Math.round(r.top)}..${Math.round(r.bottom)} of ${h}`);
    }
    if (window.scrollY !== 0) bad.push('scrolled');
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) bad.push('sideways scroll');
    return bad;
  }, FIRST_SCREEN);
}

/** Words in text a visitor can see inside the viewport. */
async function visibleWords(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || !node.textContent?.trim()) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const inView = [...range.getClientRects()].some((r) => r.width > 0 && r.bottom > 0 && r.top < window.innerHeight);
      if (inView) n += node.textContent.trim().split(/\s+/).length;
    }
    // Form fields hold text too (the amount).
    for (const input of document.querySelectorAll('input')) {
      const r = input.getBoundingClientRect();
      if (input.value.trim() && r.bottom > 0 && r.top < window.innerHeight) n += input.value.trim().split(/\s+/).length;
    }
    return n;
  });
}

/** The proxy checks: does the primary button stand out most in the card, is the amount the largest text there. */
async function proxyChecks(page: Page): Promise<{ button: boolean; amount: boolean }> {
  return page.evaluate(() => {
    const rgb = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = (c: string): number => {
      const [r = 0, g = 0, b = 0] = rgb(c).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    const opaque = (c: string): boolean => {
      const v = rgb(c);
      return v.length >= 3 && (v.length < 4 || v[3]! > 0);
    };
    const card = document.querySelector<HTMLElement>('section.card')!;
    const cardBg = getComputedStyle(card).backgroundColor;
    const button = document.querySelector<HTMLElement>('section.card .button--primary')!;
    // Stand out: an element's own background against the card's. The button must be at least the highest.
    const own = (el: Element): number => {
      const bg = getComputedStyle(el).backgroundColor;
      return opaque(bg) ? ratio(bg, cardBg) : 0;
    };
    const others = [...card.querySelectorAll('*')].filter((el) => el !== button && !button.contains(el) && (el as HTMLElement).offsetParent !== null);
    const buttonWins = others.every((el) => own(el) <= own(button));
    const size = (el: Element): number => parseFloat(getComputedStyle(el).fontSize);
    const input = card.querySelector('.field__input');
    const texts = others.filter((el) => el !== input && [...el.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent?.trim()));
    const amountWins = input !== null && texts.every((el) => size(el) <= size(input));
    return { button: buttonWins, amount: amountWins };
  });
}

/** Scores one numbered answer per QUESTIONS line against the page: swap BCH and dollars, the button's label, an amount shown. */
export function scoreAnswers(answer: string, primaryLabel: string, receiveLine: string): number {
  const lines = answer.split('\n').map((l) => l.trim()).filter(Boolean);
  const line = (n: number): string => lines.find((l) => l.startsWith(`${n}.`) || l.startsWith(`${n})`)) ?? '';
  const does = /\b(swap|exchange|convert|trade)\b/i.test(line(1)) && /\b(BCH|bitcoin cash)\b/i.test(line(1)) && /(dollar|USD|stablecoin|PUSD)/i.test(line(1));
  const presses = line(2).toLowerCase().includes(primaryLabel.toLowerCase());
  const numbers = receiveLine.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const receives = numbers.some((n) => line(3).includes(n));
  return [does, presses, receives].filter(Boolean).length;
}

function ask(png: string): Promise<string> {
  const prompt = `Look only at the screenshot ${png}. Answer each question in one line, numbered 1 to 3.\n${QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn('sh', ['-c', ASK.replaceAll('{png}', png)], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`--ask exited ${code}`))));
    child.stdin!.end(prompt);
  });
}

async function scoreDirection(theme: string, port: number, browsers: Record<Engine, Browser>): Promise<DirectionScore> {
  const base = `http://127.0.0.1:${port}`;
  const server = startServer({ port, dataDir: path.join(OUT, `data-${theme}`), patch: { ui: { theme } } });
  try {
    await waitHealthy(base);
    const contrast: string[] = [];
    const layout: string[] = [];
    for (const engine of Object.keys(ENGINES) as Engine[]) {
      for (const lang of LANGS) {
        for (const at of ['/', '/how']) {
          const page = await open(browsers[engine], engine, base, lang, at);
          const theme_ = await page.locator('html').getAttribute('data-theme');
          if (theme_ !== theme) throw new Error(`${at} wears ${theme_}, not ${theme}`);
          contrast.push(...(await contrastClean(page)).map((t) => `${engine} ${lang} ${at} ${t}`));
          if (engine === 'webkit-iphone13' && at === '/') layout.push(...(await firstScreen(page)).map((b) => `${lang} ${b}`));
          await page.context().close();
        }
      }
    }
    const shots: Record<Engine, string> = {
      'webkit-iphone13': path.resolve(OUT, `${theme}-iphone13.png`),
      'chromium-desktop': path.resolve(OUT, `${theme}-desktop.png`),
    };
    let words = 0;
    let proxy = 0;
    let primaryLabel = '';
    let receiveLine = '';
    for (const engine of Object.keys(ENGINES) as Engine[]) {
      const page = await open(browsers[engine], engine, base, 'en', '/');
      if (engine === 'webkit-iphone13') {
        words = await visibleWords(page);
        const checks = await proxyChecks(page);
        proxy = Number(checks.button) + Number(checks.amount) + Number(words <= PROXY_MAX_WORDS);
        primaryLabel = (await page.locator('section.card .button--primary').innerText()).trim();
        receiveLine = (await page.locator('.swap__receive').innerText()).trim();
      }
      await page.screenshot({ path: shots[engine] });
      await page.context().close();
    }
    let limaSaat = proxy;
    let kaedah = 'proxy: button stands out most, amount is the largest text, at most 60 words';
    if (ASK) {
      const answer = await ask(shots['webkit-iphone13']);
      writeFileSync(path.join(OUT, `${theme}-answers.txt`), answer);
      limaSaat = scoreAnswers(answer, primaryLabel || en['wallet.connect'], receiveLine);
      kaedah = `model: ${ASK.split(' ')[0]}`;
    }
    if (contrast.length) console.error(`${theme} contrast: ${contrast.slice(0, 8).join('; ')}`);
    if (layout.length) console.error(`${theme} first screen: ${layout.join('; ')}`);
    return { tema: theme, aa: contrast.length === 0, skrinPertama: layout.length === 0, limaSaat, perkataan: words, kaedah };
  } finally {
    server.kill();
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const theme of Object.values(DIRECTIONS)) {
    if (!config.ui.themes.includes(theme)) throw new Error(`config ui.themes lacks ${theme}`);
  }
  const browsers = { 'chromium-desktop': await ENGINES['chromium-desktop'].launch(), 'webkit-iphone13': await ENGINES['webkit-iphone13'].launch() };
  try {
    const scores = {} as Scores;
    for (const [i, letter] of LETTERS.entries()) {
      scores[letter] = await scoreDirection(DIRECTIONS[letter], PORT + i, browsers);
      console.log(`${letter} ${JSON.stringify(scores[letter])}`);
    }
    writeFileSync(path.join(OUT, 'skor.json'), `${JSON.stringify(scores, null, 2)}\n`);
    console.log(`order: ${rank(scores).join(' ')}`);
  } finally {
    await Promise.all(Object.values(browsers).map((b) => b.close()));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
