// A payment seen closes the QR code first, then the ferry moves into view, then one arrival plays (ferry/reveal.ts).
// A recorder in the page notes the moment each value of data-qr (QR wrapper) and data-arrive (ferry) first shows,
// and whether a QR code is still in the page when the arrival starts. Covered: a landing paid from outside the page
// (seen by the card's own polling), a landing paid from the connected wallet (the page then goes to the status
// link, only after the arrival), a Sampan Pay invoice, and reduced motion (no arrival, end state at once).
// Nothing makes a sound throughout.
import { randomBytes } from 'node:crypto';
import { encodeLockingBytecodeP2pkh, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { PAY_PORT_OFFSET } from '../playwright.config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake servers');
const base = Number(process.env.E2E_PORT ?? 4173);
const landingUrl = `http://127.0.0.1:${base + 1}`;
const payUrl = `http://127.0.0.1:${base + PAY_PORT_OFFSET}`;

interface Mark {
  attr: 'qr' | 'arrive';
  value: string;
  t: number;
  /** svg.payqr elements in the page at that moment. */
  qrs: number;
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/**
 * Records every change of the QR wrapper's data-qr and the ferry's data-arrive (and counts sounds, as in
 * qr-first.spec.ts). The binding lives on the Node side, so marks survive the page going to the status link.
 */
async function record(page: Page): Promise<Mark[]> {
  const marks: Mark[] = [];
  await page.exposeFunction('__mark', (m: Mark) => marks.push(m));
  await page.addInitScript(() => {
    const w = window as unknown as { __sounds: number; __mark: (m: unknown) => void; AudioContext?: unknown; webkitAudioContext?: unknown };
    w.__sounds = 0;
    for (const name of ['AudioContext', 'webkitAudioContext'] as const) {
      const Original = w[name] as (new (...a: unknown[]) => object) | undefined;
      if (!Original) continue;
      w[name] = class extends Original {
        constructor(...a: unknown[]) {
          super(...a);
          w.__sounds++;
        }
      };
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__sounds++;
      return play.call(this);
    };
    const last: Record<string, string | undefined> = {};
    const look = (): void => {
      const now = {
        qr: document.querySelector<HTMLElement>('.land__qr, .payinv__qr')?.dataset.qr,
        arrive: document.querySelector<HTMLElement>('.ferry[data-arrive]')?.dataset.arrive,
      };
      for (const attr of ['qr', 'arrive'] as const) {
        const value = now[attr];
        if (value === undefined || value === last[attr]) continue;
        last[attr] = value;
        w.__mark({ attr, value, t: performance.timeOrigin + performance.now(), qrs: document.querySelectorAll('svg.payqr').length });
      }
    };
    new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-qr', 'data-arrive'] });
  });
  return marks;
}

const first = (marks: Mark[], attr: Mark['attr'], value: string): Mark | undefined => marks.find((m) => m.attr === attr && m.value === value);
const sounds = (page: Page) => page.evaluate(() => (window as unknown as { __sounds: number }).__sounds);

/** Resolves once the ferry is playing its arrival with its whole box inside the viewport. */
const ferryInViewWhilePlaying = (page: Page) =>
  page.waitForFunction(
    () => {
      const f = document.querySelector('.ferry[data-arrive="playing"]');
      if (!f) return false;
      const r = f.getBoundingClientRect();
      return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
    },
    null,
    { timeout: 30_000, polling: 50 },
  );

/** closing < closed < moving < playing < done, the QR gone from the page when the arrival starts. */
function expectOrder(marks: Mark[]): void {
  const closing = first(marks, 'qr', 'closing');
  const closed = first(marks, 'qr', 'closed');
  const moving = first(marks, 'arrive', 'moving');
  const playing = first(marks, 'arrive', 'playing');
  const done = first(marks, 'arrive', 'done');
  expect(closing && closed && moving && playing && done, JSON.stringify(marks)).toBeTruthy();
  expect(closing!.t).toBeLessThanOrEqual(closed!.t);
  expect(closed!.t).toBeLessThanOrEqual(moving!.t);
  expect(moving!.t).toBeLessThan(playing!.t);
  expect(playing!.t).toBeLessThan(done!.t);
  expect(playing!.qrs).toBe(0);
  // Once closed the QR never comes back, and the arrival plays once.
  expect(marks.filter((m) => m.attr === 'qr' && m.t > closed!.t)).toEqual([]);
  expect(marks.filter((m) => m.attr === 'arrive' && m.value === 'playing')).toHaveLength(1);
}

/** A token address nobody used before, so the landing address is new and still open. */
function freshOwner(): string {
  const owner = lockingBytecodeToCashAddress({ bytecode: encodeLockingBytecodeP2pkh(new Uint8Array(randomBytes(20))), prefix: 'bitcoincash', tokenSupport: true });
  if (typeof owner === 'string') throw new Error(owner);
  return owner.address;
}

/**
 * Bring in, a fresh owner pasted and confirmed: the QR opens by itself. Returns the crossing id once the card has read
 * the address as still open (its first status answer), as a payer would only pay after seeing the card: the card
 * watches only an address that was open when it opened, so paying before that first answer is a different case.
 */
async function openLanding(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('tab', { name: en['tabs.in'] }).click();
  const input = page.getByRole('textbox');
  await input.fill(freshOwner());
  const firstStatus = page.waitForResponse((r) => /\/api\/crossings\/[0-9a-f]{32}$/.test(new URL(r.url()).pathname) && r.request().method() === 'GET', { timeout: 20_000 });
  await input.press('Enter');
  await expect(page.locator('.land__qr[data-qr="open"] svg.payqr')).toBeVisible({ timeout: 20_000 });
  expect(((await (await firstStatus).json()) as { status: string }).status).toBe('open');
  const href = await page.getByRole('link', { name: en['land.follow'] }).getAttribute('href');
  const id = /^\/c\/([0-9a-f]{32})#/.exec(href ?? '')?.[1];
  if (!id) throw new Error(`no crossing id in ${href}`);
  return id;
}

async function payFromOutside(request: APIRequestContext, id: string): Promise<void> {
  expect((await request.post(`${landingUrl}/api/landing/fake/pay/${id}`, { data: {} })).ok()).toBe(true);
}

test.describe('landing card', () => {
  test.use({ baseURL: landingUrl });

  test('a payment from another wallet: the card notices it, closes the QR, moves the ferry into view, then arrives', async ({ page, request }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    const marks = await record(page);
    const id = await openLanding(page);
    await expect(page.locator('.ferry[data-arrive="idle"]')).toHaveCount(1);
    const inView = ferryInViewWhilePlaying(page);
    await payFromOutside(request, id);
    await inView;
    await expect(page.locator('.ferry[data-arrive="done"][data-state="arrived"]')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('.land__detected')).toHaveText(en['land.detected']);
    await expect(page.locator('svg.payqr')).toHaveCount(0);
    expectOrder(marks);
    expect(await sounds(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a payment from the connected wallet: QR closes at once, the arrival plays, only then the status page', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    const marks = await record(page);
    await openLanding(page);
    const primary = page.locator('.button--primary');
    await expect(primary).toHaveText(en['land.connectToPay']);
    await primary.click();
    await expect(primary).toHaveText(en['land.pay'], { timeout: 20_000 });
    const inView = ferryInViewWhilePlaying(page);
    await primary.click();
    await inView;
    await page.waitForURL(/\/c\/[0-9a-f]{32}#card=[A-Za-z0-9_-]+$/, { timeout: 30_000 });
    expectOrder(marks);
    expect(await sounds(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('with reduced motion the QR goes and the end state shows at once: no closing, no arrival', async ({ page, request }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = collectErrors(page);
    const marks = await record(page);
    const id = await openLanding(page);
    await payFromOutside(request, id);
    await expect(page.locator('.ferry[data-arrive="done"]')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('svg.payqr')).toHaveCount(0);
    expect(first(marks, 'qr', 'closing')).toBeUndefined();
    expect(first(marks, 'arrive', 'playing')).toBeUndefined();
    expect(await sounds(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('Sampan Pay invoice', () => {
  test.use({ baseURL: payUrl });

  test('a payment seen on the invoice page closes the QR, then the ferry carries it to the shop', async ({ page, request }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    const marks = await record(page);
    await page.goto('/pay');
    await page.getByRole('button', { name: en['pay.shop.buy'] }).click();
    await page.waitForURL(/\/pay\/i\/[0-9a-f]{32}$/);
    const id = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.locator('.payinv__qr[data-qr="open"] svg.payqr')).toBeVisible();
    const inView = ferryInViewWhilePlaying(page);
    expect((await request.post(`/api/pay/fake/pay/${id}`, { data: {} })).ok()).toBe(true);
    // The page's own button, as a visitor would press it (the page also asks again by itself).
    await page.getByRole('button', { name: en['crossing.check'] }).click();
    await inView;
    await expect(page.locator('.ferry[data-arrive="done"][data-state="arrived"]')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('.payinv__detected')).toHaveText(en['pay.inv.detected']);
    await expect(page.locator('.payinv__box')).toHaveCount(0);
    expectOrder(marks);
    expect(errors).toEqual([]);

    // Opened again on the paid invoice: the end state at once, no closing, no arrival, no "payment seen". (Errors are
    // not checked past the reload: WebKit reports a poll cut short by navigation as one.)
    const seen = marks.length;
    await page.reload();
    await expect(page.locator('.ferry[data-arrive="done"]')).toHaveCount(1);
    const again = marks.slice(seen);
    expect(first(again, 'qr', 'closing')).toBeUndefined();
    expect(first(again, 'arrive', 'playing')).toBeUndefined();
    await expect(page.locator('.payinv__detected')).toHaveCount(0);
    expect(await sounds(page)).toBe(0);
  });
});
