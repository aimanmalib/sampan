// The WizardConnect pairing dialog, measured: the wizard's hat leads the title without changing its name, "Copy link"
// sits straight under the QR code (the next thing a Tab reaches), both the code and the button copy the same pairing
// link with visible feedback in a live region, the code still decodes to that link with the WizardConnect package's
// logo over its middle, and nothing spills sideways at 320 px or on an iPhone 13.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import jsqr from 'jsqr';
import en from '../lang/en.json' with { type: 'json' };

/** jsqr is a CommonJS bundle: Node's type view sees its module object, the test runner hands over the function. */
type Decode = (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;
const jsQR = ((jsqr as unknown as { default?: Decode }).default ?? jsqr) as unknown as Decode;

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake servers');
const base = Number(process.env.E2E_PORT ?? 4173);
test.use({ baseURL: `http://127.0.0.1:${base + 1}` });

/** Largest gap in CSS px between the foot of the QR button and the top of "Copy link" (the dialog's grid gap is 12). */
const MAX_GAP = 24;

async function allowClipboard(context: BrowserContext, browserName: string): Promise<void> {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
}

/**
 * Opens the real pairing (not the fake wallet), so the link is made in the page. The configured relays are answered
 * by a silent stand-in that never reaches the network: the pairing simply waits, with no reconnect noise.
 */
async function openPairing(page: Page): Promise<ReturnType<Page['getByRole']>> {
  await page.routeWebSocket(/^wss?:\/\//, () => undefined);
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as object;
    await route.fulfill({ response: res, json: { ...body, fake: false } });
  });
  await page.goto('/');
  await page.locator('.button--primary').click();
  const dialog = page.getByRole('dialog', { name: en['wallet.dialogTitle'], exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function noSidewaysSpill(page: Page): Promise<void> {
  const widths = await page.evaluate(() => {
    const box = document.querySelector('.connect__box')!;
    return [document.documentElement.scrollWidth, document.documentElement.clientWidth, box.scrollWidth, box.clientWidth];
  });
  expect(widths[0]).toBeLessThanOrEqual(widths[1]!);
  expect(widths[2]).toBeLessThanOrEqual(widths[3]!);
}

for (const width of [null, 320] as const) {
  test(`pairing dialog${width ? ` at ${width} px` : ''}: hat in the title, Copy link straight under the code`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    if (width) await page.setViewportSize({ width, height: 640 });
    const dialog = await openPairing(page);

    const heading = dialog.getByRole('heading', { name: en['wallet.dialogTitle'], exact: true });
    await expect(heading.locator('svg.connect__hat')).toHaveAttribute('aria-hidden', 'true');
    await expect(heading.locator('svg.connect__hat')).toBeVisible();

    const qr = dialog.getByRole('button', { name: en['wallet.qrCopy'] });
    const copy = dialog.getByRole('button', { name: en['wallet.copyLink'] });
    const q = (await qr.boundingBox())!;
    const c = (await copy.boundingBox())!;
    expect(c.y).toBeGreaterThanOrEqual(q.y + q.height - 1);
    expect(c.y - (q.y + q.height)).toBeLessThanOrEqual(MAX_GAP);
    // The drawn code is whole inside the frame that clips it and shares a centre line with "Copy link" and the dialog.
    const code = (await qr.locator('canvas').boundingBox())!;
    const frame = (await dialog.locator('.connect__qr').boundingBox())!;
    const d = (await dialog.boundingBox())!;
    expect(code.x).toBeGreaterThanOrEqual(frame.x - 0.5);
    expect(code.x + code.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    expect(Math.abs(c.x + c.width / 2 - (code.x + code.width / 2))).toBeLessThan(2);
    expect(Math.abs(d.x + d.width / 2 - (code.x + code.width / 2))).toBeLessThan(2);
    expect(c.height).toBeGreaterThanOrEqual(44);
    await qr.focus();
    await page.keyboard.press('Tab');
    await expect(copy).toBeFocused();

    await noSidewaysSpill(page);
    expect(errors).toEqual([]);
  });
}

test('the QR code and Copy link copy the same pairing link, and say so', async ({ page, context, browserName }) => {
  await allowClipboard(context, browserName);
  const dialog = await openPairing(page);
  const live = dialog.locator('.qrcopy__done');
  await expect(live).toHaveAttribute('aria-live', 'polite');
  await expect(live).toHaveText('');

  await dialog.getByRole('button', { name: en['wallet.qrCopy'] }).click();
  await expect(live).toHaveText(en['wallet.qrCopied']);
  await expect(live).toBeVisible();
  const fromQr = browserName === 'chromium' ? await page.evaluate(() => navigator.clipboard.readText()) : null;

  await dialog.getByRole('button', { name: en['wallet.copyLink'] }).click();
  await expect(dialog.getByRole('button', { name: en['wallet.copied'] })).toBeVisible();
  if (fromQr !== null) {
    expect(fromQr).toMatch(/^wiz/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fromQr);
  }
});

/** Pixels of the pairing code's canvas once the package has laid its hat logo over the middle (blue pixels present). */
async function codePixels(page: Page): Promise<{ data: number[]; width: number; height: number }> {
  const image = (withData: boolean) =>
    page.evaluate((all) => {
      // Read at one pixel per CSS pixel (the canvas is drawn at the device's pixel ratio), so the copy stays small.
      const canvas = document.querySelector<HTMLCanvasElement>('.connect__qr canvas')!;
      const small = document.createElement('canvas');
      small.width = small.height = canvas.clientWidth;
      const ctx = small.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, 0, 0, small.width, small.height);
      const { data, width, height } = ctx.getImageData(0, 0, small.width, small.height);
      let blue = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 2]! > data[i]! + 60) blue++;
      return { blue, width, height, data: all ? Array.from(data) : [] };
    }, withData);
  await expect.poll(async () => (await image(false)).blue).toBeGreaterThan(0);
  return image(true);
}

test('the code still reads back as the pairing link with the logo in its middle', async ({ page, context, browserName }) => {
  test.slow(); // reads and decodes the code's pixels
  await allowClipboard(context, browserName);
  const dialog = await openPairing(page);
  const pixels = await codePixels(page);
  const decoded = jsQR(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height);
  // The code holds the link in QR alphanumeric form: percent-encoded and in capitals.
  expect(decoded?.data ?? '').toMatch(/^WIZ:\/\//);
  await dialog.getByRole('button', { name: en['wallet.copyLink'] }).click();
  await expect(dialog.getByRole('button', { name: en['wallet.copied'] })).toBeVisible();
  if (browserName === 'chromium') {
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(decodeURIComponent(decoded!.data).toLowerCase()).toBe(link.toLowerCase());
  }
});
