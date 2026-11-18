// Paying a Nostr identity in Bring in, against fake servers. The relays are answered by the spec itself
// (page.routeWebSocket), with Tambat's published test vector as the identity's proof event: a good proof shows the
// verified card with the token address of the proved address and lets the landing open; a proof changed after
// signing is dropped, so the reason shows and the button stays off. With features.nostrSend off, nothing about Nostr
// is drawn and no relay is opened. No request ever leaves for an identity server.
import { decodeCashAddress, encodeCashAddress } from '@bitauth/libauth';
import { expect, test, type Page } from '@playwright/test';
import shipped from '../config/sampan.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };
import owner from '../tests/fixtures/nostr-owner-binding.json' with { type: 'json' };
import vectors from '../tests/fixtures/tambat-vectors.json' with { type: 'json' };
import { NOSTR_PORT_OFFSET } from '../playwright.config.js';
import { answerRelays } from './nostr-relays.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake servers');
const base = Number(process.env.E2E_PORT ?? 4173);
const nostrUrl = `http://127.0.0.1:${base + NOSTR_PORT_OFFSET}`;
/** The landing server (playwright.config.ts, port + 1) has features.nostrSend off. */
const offUrl = `http://127.0.0.1:${base + 1}`;

type NostrEvent = typeof vectors.bindingEvent;
const NPUB = vectors.nostr.npub;
const PROVED = vectors.bch.address.bitcoincash;

/** The token-aware address with the proved address's hash: what may own the landing. */
function tokenAddressOf(address: string): string {
  const decoded = decodeCashAddress(address);
  if (typeof decoded === 'string') throw new Error(decoded);
  const encoded = encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkhWithTokens', payload: decoded.payload });
  return encoded.address;
}

interface Watch {
  /** Relay sockets the page opened (answered by the spec). */
  sockets: string[];
  /** Any other WebSocket the page opened. */
  unrouted: string[];
  requests: string[];
  errors: string[];
}

/** Answers every relay with `events` then EOSE, and records the sockets, requests and console errors of the page. */
async function relays(page: Page, events: NostrEvent[], silentFor: string[] = []): Promise<Watch> {
  const watch: Watch = { sockets: [], unrouted: [], requests: [], errors: [] };
  page.on('websocket', (ws) => watch.unrouted.push(ws.url()));
  page.on('request', (r) => watch.requests.push(r.url()));
  page.on('console', (m) => m.type() === 'error' && watch.errors.push(m.text()));
  page.on('pageerror', (e) => watch.errors.push(e.message));
  watch.sockets = await answerRelays(page, events, silentFor);
  return watch;
}

/** With E2E_SHOTS_DIR set, saves the card; console errors raised by WebKit's screenshot itself are dropped. */
async function shot(page: Page, watch: Watch, name: string, project: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  const before = watch.errors.length;
  await page.locator('section.card').screenshot({ path: `${dir}/sampan-nostr-${name}-${project}.png` });
  await page.waitForTimeout(100);
  watch.errors.splice(before);
}

/** How long a committed identity is watched for a landing that opens by itself (the effect runs on the next render). */
const NO_AUTO_OPEN_MS = 1_500;
const ownerField = (page: Page) => page.locator('.field__input--address');
const primary = (page: Page) => page.locator('.button--primary');

test.describe('features.nostrSend on', () => {
  test.use({ baseURL: nostrUrl });

  test('a verified identity shows its card and owns the landing', async ({ page }, info) => {
    test.setTimeout(60_000);
    const watch = await relays(page, [vectors.bindingEvent]);
    await page.goto('/');
    await page.getByRole('tab', { name: en['tabs.in'] }).click();
    await expect(page.locator('.field__label')).toHaveText(en['land.ownerLabelNostr'].replace('{symbol}', 'PUSD'));
    await ownerField(page).fill(NPUB);

    const card = page.locator('[data-nostr=verified]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText(en['nostr.verified']);
    await expect(card.locator('.nostr__npub')).toHaveText(`npub1${NPUB.slice(5, 5 + shipped.nostrId.npubShortChars)}…${NPUB.slice(-shipped.nostrId.npubShortChars)}`);
    await expect(card.locator('.nostr__address')).toHaveText(tokenAddressOf(PROVED));
    await expect(card.getByRole('link', { name: en['nostr.howLink'] })).toHaveAttribute('href', '/how#nostr');
    // Every configured relay was asked, each once.
    expect(watch.sockets.map((u) => new URL(u).origin).sort()).toEqual(shipped.nostrId.relays.map((u) => new URL(u).origin).sort());
    await expect(primary(page)).toHaveCount(1);
    await expect(primary(page)).toHaveText(en['land.open']);
    await expect(primary(page)).toBeEnabled();
    // The address does not open by itself for an identity: the verified card stays in view until the button. Leaving
    // the field commits the text (as a paste or Enter would), which is what lets a plain address open by itself; no
    // POST /api/land/open may follow within the window, and no address may be drawn.
    const early = page.waitForRequest((r) => r.url().endsWith('/api/land/open'), { timeout: NO_AUTO_OPEN_MS }).then(() => true, () => false);
    await ownerField(page).blur();
    expect(await early, 'an identity must not open the landing by itself').toBe(false);
    await expect(page.locator('.land__address')).toHaveCount(0);
    await expect(primary(page)).toBeEnabled();
    await shot(page, watch, 'verified', info.project.name);

    const opened = page.waitForRequest((r) => r.url().endsWith('/api/land/open') && r.method() === 'POST');
    await primary(page).click();
    expect(((await opened).postDataJSON() as { ownerAddress: string }).ownerAddress).toBe(tokenAddressOf(PROVED));
    await expect(page.locator('.land__address')).toHaveText(/^bitcoincash:p[0-9a-z]{41}$/, { timeout: 20_000 });

    expect(watch.requests.filter((u) => u.includes('tambat'))).toEqual([]);
    expect(watch.errors).toEqual([]);
  });

  test('a proof changed after signing is not used: reason shown, button off, no address', async ({ page }, info) => {
    const tampered = { ...vectors.bindingEvent, created_at: vectors.bindingEvent.created_at + 60 };
    const watch = await relays(page, [tampered]);
    await page.goto('/');
    await page.getByRole('tab', { name: en['tabs.in'] }).click();
    await ownerField(page).fill(NPUB);

    const failed = page.locator('[data-nostr=failed]');
    await expect(failed).toBeVisible({ timeout: 15_000 });
    await expect(failed).toHaveText(en['nostr.reason.not_found']);
    await expect(page.locator('[data-nostr=verified]')).toHaveCount(0);
    await expect(primary(page)).toBeDisabled();
    await expect(page.locator('section.card')).not.toContainText(PROVED.slice('bitcoincash:'.length));
    await expect(page.locator('section.card')).not.toContainText(tokenAddressOf(PROVED).slice('bitcoincash:'.length));
    await shot(page, watch, 'failed', info.project.name);

    // Changing the text drops the old answer before the new one: a half-typed key gets its reason once the field is left.
    await ownerField(page).fill('npub1abc');
    await expect(failed).toHaveCount(0);
    await ownerField(page).blur();
    await expect(page.locator('[data-reason=input_invalid]')).toHaveText(en['nostr.reason.input_invalid']);
    await expect(primary(page)).toBeDisabled();
    expect(watch.errors).toEqual([]);
  });

  test('another identity drops the verified card at once, before its own answer', async ({ page }) => {
    // The relays never answer for the second key, so its lookup stays open until the query timeout.
    const watch = await relays(page, [vectors.bindingEvent], [owner.event.pubkey]);
    await page.goto('/');
    await page.getByRole('tab', { name: en['tabs.in'] }).click();
    await ownerField(page).fill(NPUB);
    await expect(page.locator('[data-nostr=verified]')).toBeVisible({ timeout: 15_000 });
    await ownerField(page).fill(owner.npub);
    await expect(page.locator('[data-nostr=checking]')).toHaveText(en['nostr.checking']);
    await expect(page.locator('[data-nostr=verified]')).toHaveCount(0);
    await expect(primary(page)).toBeDisabled();
    await expect(page.locator('[data-reason=relays_unreachable]')).toBeVisible({ timeout: shipped.nostrId.queryTimeoutMs + 5_000 });
    await expect(primary(page)).toBeDisabled();
    expect(watch.errors).toEqual([]);
  });

  test('/how#nostr lists the steps and the relays from config', async ({ page }) => {
    await page.goto('/how#nostr');
    const section = page.locator('section#nostr');
    await expect(section.getByRole('heading', { level: 2 })).toHaveText(en['how.nostr.title']);
    for (const relay of shipped.nostrId.relays) await expect(section.getByText(relay, { exact: true })).toBeVisible();
    await expect(section).toContainText(en['how.nostr.limit']);
  });
});

test.describe('features.nostrSend off', () => {
  test.use({ baseURL: offUrl });

  test('nothing about Nostr is drawn and no relay is opened', async ({ page }) => {
    const watch = await relays(page, [vectors.bindingEvent]);
    await page.goto('/');
    await page.getByRole('tab', { name: en['tabs.in'] }).click();
    await expect(page.locator('.field__label')).toHaveText(en['land.ownerLabel'].replace('{symbol}', 'PUSD'));
    await ownerField(page).fill(NPUB);
    await ownerField(page).blur();
    await expect(page.getByText(en['land.err.owner'])).toBeVisible();
    await expect(page.locator('[data-nostr]')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/nostr/i);
    await page.goto('/how');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('section#nostr')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/nostr/i);
    expect(watch.sockets).toEqual([]);
    expect(watch.unrouted).toEqual([]);
  });
});
