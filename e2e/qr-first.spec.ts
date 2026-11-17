// QR first: the landing card shows its QR code as soon as the owner is known, without "Get my landing address";
// with ui.qrAutoOpen off the old button is back. QR codes are buttons that copy their link, every button that starts
// WizardConnect carries the hat icon, and nothing on the page ever plays a sound.
import { encodeLockingBytecodeP2pkh, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { PAY_PORT_OFFSET, QR_OFF_PORT_OFFSET } from '../playwright.config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake servers');
const base = Number(process.env.E2E_PORT ?? 4173);
const landingUrl = `http://127.0.0.1:${base + 1}`;

const primary = (page: Page) => page.locator('.button--primary');

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Counts every attempt to make a sound: a new AudioContext or a media element starting to play. */
async function countSounds(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __sounds: number; AudioContext?: unknown; webkitAudioContext?: unknown };
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
  });
}
const sounds = (page: Page) => page.evaluate(() => (window as unknown as { __sounds: number }).__sounds);

async function allowClipboard(context: BrowserContext, browserName: string): Promise<void> {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
}

function ownerAddress(): string {
  const owner = lockingBytecodeToCashAddress({ bytecode: encodeLockingBytecodeP2pkh(new Uint8Array(20).fill(0x33)), prefix: 'bitcoincash', tokenSupport: true });
  if (typeof owner === 'string') throw new Error(owner);
  return owner.address;
}

/** Clicks a QR code and checks that it copied `expected` (Chromium reads the clipboard; WebKit shows the copied text). */
async function clickCopies(page: Page, qr: string, done: string, browserName: string, expected: RegExp): Promise<void> {
  const box = page.locator('.qrcopy').filter({ has: page.locator(qr) });
  await box.locator('.qrcopy__button').click();
  await expect(box.locator('.qrcopy__done')).toHaveText(done);
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(expected);
}

test.describe('landing card with ui.qrAutoOpen on', () => {
  test.use({ baseURL: landingUrl });

  test('a connected wallet opens the QR code with no click on "Get my landing address"; the QR copies its link', async ({ page, context, browserName }) => {
    await allowClipboard(context, browserName);
    await countSounds(page);
    const errors = collectErrors(page);
    const openClicks: string[] = [];
    await page.exposeFunction('__openClicked', (label: string) => openClicks.push(label));
    await page.addInitScript((label) => {
      document.addEventListener('click', (e) => {
        const b = (e.target as Element | null)?.closest('button');
        if (b?.textContent === label) (window as unknown as { __openClicked: (l: string) => void }).__openClicked(label);
      }, true);
    }, en['land.open']);
    await page.goto('/');
    await page.getByRole('tab', { name: en['tabs.in'] }).click();
    await expect(primary(page)).toHaveText(en['wallet.connect']);
    await primary(page).click();

    await expect(page.locator('svg.payqr')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.land__address')).toHaveText(/^bitcoincash:p[0-9a-z]{41}$/);
    await expect(primary(page)).toHaveText(en['land.pay']);
    expect(openClicks).toEqual([]);
    await clickCopies(page, 'svg.payqr', en['land.copied'], browserName, /^bitcoincash:p[0-9a-z]{41}\?amount=/);
    expect(await sounds(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('before the owner is known: an empty QR frame says where the code will appear; Connect carries the hat', async ({ page }) => {
    await countSounds(page);
    await page.goto('/');
    // The Connect button carries the hat and keeps its name, on the first tab and in Bring in.
    await expect(page.getByRole('button', { name: en['wallet.connect'], exact: true })).toBeVisible();
    await expect(primary(page).locator('svg.button__icon')).toHaveCount(1);
    await page.getByRole('tab', { name: en['tabs.in'] }).click();
    await expect(page.locator('[data-qr="waiting"]')).toContainText(en['land.qrWaiting'].replace('{symbol}', 'PUSD'));
    await expect(page.getByRole('button', { name: en['wallet.connect'], exact: true })).toBeVisible();
    await expect(primary(page).locator('svg.button__icon')).toHaveCount(1);
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    expect(await sounds(page)).toBe(0);
  });

  test('typing an address does not open it; pasting one does, and Enter does', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.getByRole('tab', { name: en['tabs.in'] }).click();
    const input = page.locator('.field__input--address');
    await input.fill(ownerAddress());
    await expect(primary(page)).toHaveText(en['land.open']);
    await expect(primary(page)).toBeEnabled();
    await expect(page.locator('svg.payqr')).toHaveCount(0);
    // A paste event carrying the same text, while the field keeps the focus.
    await input.evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, ownerAddress());
    await expect(page.locator('svg.payqr')).toBeVisible({ timeout: 20_000 });
    await expect(input).toHaveCount(0);

    // "Make a new address" goes back to the form and does not open the same owner again by itself; Enter opens it.
    await page.getByRole('button', { name: en['land.new'] }).click();
    await expect(primary(page)).toHaveText(en['land.open']);
    await page.locator('.field__input--address').press('Enter');
    await expect(primary(page)).toHaveText(en['land.open']);
    await primary(page).click();
    await expect(page.locator('svg.payqr')).toBeVisible({ timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test('the WizardConnect dialog QR code is a button that copies the pairing link', async ({ page, context, browserName }) => {
    await allowClipboard(context, browserName);
    // The real pairing (not the fake wallet), with relays that refuse at once: the link is made in the page.
    await page.route('**/api/config', async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { connect: Record<string, unknown> };
      await route.fulfill({ response: res, json: { ...body, fake: false, connect: { ...body.connect, relayUrls: ['ws://127.0.0.1:9'] } } });
    });
    await page.goto('/');
    await primary(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const qr = dialog.getByRole('button', { name: en['wallet.qrCopy'] });
    await expect(qr).toBeVisible();
    const box = await qr.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await qr.click();
    await expect(dialog.locator('.qrcopy__done')).toHaveText(en['wallet.qrCopied']);
    if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^wiz/);
    // "Copy link" is still there.
    await expect(dialog.getByRole('button', { name: en['wallet.copyLink'] })).toBeVisible();
  });
});

test.describe('landing card with ui.qrAutoOpen off', () => {
  test.use({ baseURL: `http://127.0.0.1:${base + QR_OFF_PORT_OFFSET}` });

  test('a connected wallet waits for "Get my landing address", as before', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: en['tabs.in'] }).click();
    await expect(page.locator('[data-qr="waiting"]')).toHaveCount(0);
    await primary(page).click();
    await expect(primary(page)).toHaveText(en['land.open'], { timeout: 20_000 });
    await expect(primary(page)).toBeEnabled({ timeout: 20_000 });
    await expect(page.locator('svg.payqr')).toHaveCount(0);
    await primary(page).click();
    await expect(page.locator('svg.payqr')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Sampan Pay invoice', () => {
  test.use({ baseURL: `http://127.0.0.1:${base + PAY_PORT_OFFSET}` });

  test('the invoice shows its QR code with no click, and the QR copies the payment link', async ({ page, context, browserName }) => {
    await allowClipboard(context, browserName);
    await countSounds(page);
    const errors = collectErrors(page);
    await page.goto('/pay');
    await page.getByRole('button', { name: en['pay.shop.buy'] }).click();
    await page.waitForURL(/\/pay\/i\/[0-9a-f]{32}$/);
    await expect(page.locator('svg.payqr')).toBeVisible();
    await clickCopies(page, 'svg.payqr', en['land.copied'], browserName, /^bitcoincash:p[0-9a-z]{41}\?amount=0\.\d+$/);
    expect(await sounds(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
