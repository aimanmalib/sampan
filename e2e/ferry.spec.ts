// The ferry on the status pages with ui.ferryMotion switched on for the test (the shipped config keeps it off): the
// page's config answer is patched in the browser, and the crossing answers are scripted so each kind walks through
// its statuses. The boat's step must follow every answer of GET /api/crossings/:id, and only those answers.
// Skipped against a live site.
import { encodeLockingBytecodeP2pkh, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

const ID = 'f'.repeat(32);
const TX = 'ab'.repeat(32);
const landingPort = Number(process.env.E2E_PORT ?? 4173) + 1;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
}

/** Config with the ferry on and a one-second page poll, so the scripted answers come quickly. */
async function ferryOn(page: Page): Promise<void> {
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, Record<string, unknown>>;
    await route.fulfill({ response: res, json: { ...body, ui: { ferryMotion: true }, landing: { ...body.landing, pagePollSeconds: 1 } } });
  });
}

interface Answer {
  status: string;
  txid?: string | null;
  stage?: string;
}

const crossing = (kind: string, a: Answer) => ({
  id: ID,
  kind,
  status: a.status,
  asset: kind === 'land' || kind === 'swap' ? 'PUSD' : 'USDC',
  txid: a.txid ?? null,
  createdAt: 1,
  updatedAt: 1,
  ...(kind === 'land' ? { landing: { address: null, paymentTxid: a.status === 'open' ? null : TX, watching: true } } : {}),
  ...(kind === 'out' || kind === 'in' ? { route: 'thorchain', out: a.stage ? { stage: a.stage, outTxid: a.stage === 'done' ? TX : null, outChain: 'BASE' } : null } : {}),
});

/** Serves the answers in turn (the last one again after the end) and returns how many were served. */
async function script(page: Page, kind: string, answers: Answer[]): Promise<() => number> {
  let served = 0;
  await page.route(`**/api/crossings/${ID}**`, async (route) => {
    const a = answers[Math.min(served, answers.length - 1)]!;
    served += 1;
    await route.fulfill({ json: crossing(kind, a) });
  });
  return () => served;
}

const crossingAnswer = (page: Page) => page.waitForResponse((r) => r.url().includes(`/api/crossings/${ID}`));

/** Walks the page through the answers: after each answer arrives, the ferry shows the expected step and state. */
async function walk(page: Page, kind: string, answers: Answer[], expected: [step: number, state: string][], next?: () => Promise<void>) {
  const errors = collectErrors(page);
  await ferryOn(page);
  await script(page, kind, answers);
  let answer = crossingAnswer(page);
  await page.goto(`/c/${ID}`);
  const ferry = page.locator('.crossing .ferry');
  for (const [i, [step, state]] of expected.entries()) {
    await answer;
    if (i < expected.length - 1) answer = crossingAnswer(page);
    await expect(ferry, `answer ${i + 1}`).toHaveAttribute('data-step', String(step));
    await expect(ferry, `answer ${i + 1}`).toHaveAttribute('data-state', state);
    if (i < expected.length - 1 && next) await next();
  }
  await expect(ferry).toHaveAttribute('data-motion', 'on');
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
}

test('landing: the boat moves on each answer, holds on a repeated one, and stops once the token has arrived', async ({ page }) => {
  await walk(
    page,
    'land',
    [{ status: 'open' }, { status: 'seen' }, { status: 'seen' }, { status: 'converted', txid: TX }],
    [
      [1, 'moving'],
      [2, 'moving'],
      [2, 'moving'],
      [4, 'arrived'],
    ],
  );
  await expect(page.locator('.timeline__step--done')).toHaveCount(4);
  expect(await page.locator('.ferry__bob').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('landing returned: the boat turns back to the bank it left', async ({ page }) => {
  await walk(page, 'land', [{ status: 'open' }, { status: 'returned', txid: TX }], [
    [1, 'moving'],
    [1, 'returned'],
  ]);
  await expect(page.locator('.timeline__step--done')).toHaveCount(3);
});

for (const kind of ['out', 'in'] as const) {
  test(`crossing ${kind}: sent, seen by the route, paid on the other chain`, async ({ page }) => {
    await walk(
      page,
      kind,
      [
        { status: 'broadcast', txid: TX, stage: 'unseen' },
        { status: 'broadcast', txid: TX, stage: 'pending' },
        { status: 'broadcast', txid: TX, stage: 'pending' },
        { status: 'completed', txid: TX, stage: 'done' },
      ],
      [
        [1, 'moving'],
        [2, 'moving'],
        [2, 'moving'],
        [3, 'arrived'],
      ],
    );
    await expect(page.locator('.timeline__step--done')).toHaveCount(3);
  });
}

test('swap: built, then sent after Check again', async ({ page }) => {
  await walk(
    page,
    'swap',
    [{ status: 'built' }, { status: 'broadcast', txid: TX }],
    [
      [1, 'moving'],
      [2, 'arrived'],
    ],
    () => page.getByRole('button', { name: en['crossing.check'] }).click(),
  );
});

test('the water moves while a step is under way, and not at all under reduced motion', async ({ page }) => {
  await ferryOn(page);
  await script(page, 'land', [{ status: 'seen' }]);
  await page.goto(`/c/${ID}`);
  const bob = page.locator('.ferry__bob');
  await expect(page.locator('.ferry')).toHaveAttribute('data-step', '2');
  expect(await bob.evaluate((el) => getComputedStyle(el).animationName)).toBe('ferry-bob');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => bob.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  expect(await page.locator('.ferry__lane').evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(await page.locator('.ferry__wave').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('at 320 px the ferry and its banks fit without a side scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const errors = collectErrors(page);
  await ferryOn(page);
  await script(page, 'out', [{ status: 'broadcast', txid: TX, stage: 'pending' }]);
  await page.goto(`/c/${ID}`);
  await expect(page.locator('.ferry')).toHaveAttribute('data-step', '2');
  await expect(page.locator('.ferry__banks span')).toHaveCount(2);
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test.describe('landing card', () => {
  test.use({ baseURL: `http://127.0.0.1:${landingPort}` });

  test('an opened landing address shows the ferry at the first bank, still', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const errors = collectErrors(page);
    await ferryOn(page);
    const owner = lockingBytecodeToCashAddress({ bytecode: encodeLockingBytecodeP2pkh(new Uint8Array(20).fill(0x22)), prefix: 'bitcoincash', tokenSupport: true });
    if (typeof owner === 'string') throw new Error(owner);
    await page.goto('/');
    await page.getByRole('tab', { name: en['tabs.in'] }).click();
    await page.getByRole('textbox').fill(owner.address);
    await page.locator('.button--primary').click();
    await expect(page.locator('.land__address')).toHaveText(/^bitcoincash:p/, { timeout: 20_000 });
    const ferry = page.locator('.land .ferry');
    await expect(ferry).toHaveAttribute('data-step', '1');
    await expect(ferry).toHaveAttribute('data-motion', 'off');
    expect(await page.locator('.ferry__bob').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await noHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
