// Reading a landing address off the real page and following it until the server reports the conversion: shared by
// the landing measurement (tools/measure/land.ts, a local build) and the demo recording (tools/video/record.ts, the
// live site). Every function takes the site's base URL, so the same steps run against either.
import type { Page } from '@playwright/test';
import { parseAddress } from '../../core/address.js';
import { cardFromFragment } from '../../core/landing-card.js';
import type { ElectrumChain } from '../../server/chain/electrum.js';

export interface Shown {
  address: string;
  lockHex: string;
  crossingId: string;
  /** Owner lock from the recovery card in the status link. */
  ownerLock: string;
  /** Finishing transaction already on the crossing when this owner and rate had an address before. */
  earlierTxid?: string;
}

/**
 * Opens the landing address once the owner is known. With ui.qrAutoOpen the page opens it by itself (the primary
 * button then pays, so it must not be pressed here); with the flag off it waits for "Get my landing address".
 */
export async function openAddress(page: Page, openLabel: string): Promise<void> {
  // A string, so the bundler's helpers never reach the page.
  const auto = Boolean(await page.evaluate("fetch('/api/config').then((r) => r.json()).then((c) => c.ui?.qrAutoOpen === true)"));
  if (!auto) await page.locator('.button--primary').filter({ hasText: openLabel }).click({ timeout: 30_000 });
  await page.locator('.land__address').waitFor({ timeout: 30_000 });
}

/** Reads the landing address the page shows, and the crossing id and recovery card from its "Follow this landing" link. */
export async function shownLanding(page: Page, base: string, followLabel: string): Promise<Shown> {
  const address = ((await page.locator('.land__address').textContent({ timeout: 30_000 })) ?? '').trim();
  const parsed = parseAddress(address, 'bitcoincash');
  if (typeof parsed === 'string') throw new Error(`the page shows no landing address: ${parsed}`);
  const href = (await page.getByRole('link', { name: followLabel }).getAttribute('href')) ?? '';
  const crossingId = /\/c\/([0-9a-f]{32})/.exec(href)?.[1];
  const card = cardFromFragment(href.split('#card=')[1] ?? '');
  if (!crossingId || typeof card === 'string') throw new Error('no status link with a recovery card on the page');
  if (card.card.address !== address) throw new Error('the card names another address');
  const earlier = (await fetch(`${base}/api/crossings/${crossingId}`).then((r) => r.json())) as { txid?: string | null };
  return { address, lockHex: parsed.lockingHex, crossingId, ownerLock: card.params.ownerLockHex, ...(earlier.txid ? { earlierTxid: earlier.txid } : {}) };
}

/** Polls the crossing until the server reports a new conversion or return. */
export async function waitFinished(base: string, shown: Shown, timeoutMs: number): Promise<{ status: string; txid?: string }> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const c = (await fetch(`${base}/api/crossings/${shown.crossingId}`).then((r) => r.json())) as { status: string; txid?: string };
    if ((c.status === 'converted' || c.status === 'returned') && c.txid !== shown.earlierTxid) return c;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { status: 'timeout' };
}

/** The conversion output at the owner: output 0 of the finishing transaction, carrying the token. */
export async function tokensAtOwner(chain: ElectrumChain, category: string, ownerLock: string, txid: string): Promise<bigint | undefined> {
  for (let i = 0; i < 10; i++) {
    const hit = (await chain.listUnspent(ownerLock)).find((u) => u.txid === txid && u.vout === 0);
    if (hit) return hit.token?.category.toLowerCase() === category ? hit.token.amount : undefined;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return undefined;
}
