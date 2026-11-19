// The docs/JUDGE.md walk, timed by tools/measure/judge-path.ts --judge-md (KMN4): taps from the front page to
//   judge-md:       an explorer page of a real mainnet transaction (the proof table's first transaction id link);
//   judge-md-cheat: a refusal shown on the "Try to cheat it" panel (judge box link [data-cheat-link], attempt button
//                   [data-cheat-attempt], the network's answer [data-network-said]); no row while the panel is off.
// The explorer is a third-party site: the request leaving the page ends the path and is aborted, nothing is loaded.
import type { Locator, Page } from '@playwright/test';
import en from '../../lang/en.json' with { type: 'json' };
import type { Step } from './judge-table.js';

export interface WalkClock {
  begin(): void;
  step(kind: Step['kind'], what: string): Promise<void>;
}
type Bring = (target: Locator, what: string, waitMs?: number) => Promise<void>;

/** Taps above this are recorded as they are, with a note to cut a step from JUDGE.md. */
export const JUDGE_MD_TAP_TARGET = 6;
const STEP_TIMEOUT_MS = 60_000;

/** Makes a judge box link visible: unfolds the steps with the title when they are folded. */
async function reach(page: Page, clock: WalkClock, bring: Bring, link: Locator, what: string): Promise<void> {
  if (!(await link.isVisible())) {
    await page.locator('.judge__title').click();
    await clock.step('click', `"${en['judge.title']}"`);
  }
  await bring(link, `scroll to ${what}`);
  await link.click();
  await clock.step('click', what);
}

export async function walkToExplorer(page: Page, base: string, clock: WalkClock, bring: Bring): Promise<string> {
  clock.begin();
  await page.goto(base, { waitUntil: 'load' });
  await clock.step('load', 'front page loaded');
  await page.locator('.judge').first().waitFor({ timeout: STEP_TIMEOUT_MS });
  const proof = page.locator('.judge, .judgebox').getByRole('link', { name: en['judge.proof'] }).first();
  await reach(page, clock, bring, proof, `"${en['judge.proof']}"`);
  const txid = page.locator('#proof .proof__table--flows a.mono').first();
  await txid.waitFor({ timeout: STEP_TIMEOUT_MS });
  await bring(txid, 'scroll to the first transaction id', 2000);
  const href = (await txid.getAttribute('href')) ?? '';
  await page.context().route(href, (r) => r.abort());
  const asked = page.context().waitForEvent('request', { predicate: (r) => r.url() === href, timeout: STEP_TIMEOUT_MS });
  await txid.click();
  await clock.step('click', 'the first transaction id');
  await asked;
  await clock.step('wait', 'explorer page of the transaction requested');
  return href;
}

/** Null while the judge box has no "Try to cheat it" link (features.cheatPanel off). */
export async function walkToRefusal(page: Page, base: string, clock: WalkClock, bring: Bring): Promise<string | null> {
  clock.begin();
  await page.goto(base, { waitUntil: 'load' });
  await clock.step('load', 'front page loaded');
  await page.locator('.judge').first().waitFor({ timeout: STEP_TIMEOUT_MS });
  const link = page.locator('[data-cheat-link]').first();
  if ((await link.count()) === 0) return null;
  await reach(page, clock, bring, link, '"Try to cheat it"');
  const attempt = page.locator('[data-cheat-attempt]').first();
  await attempt.waitFor({ timeout: STEP_TIMEOUT_MS });
  await bring(attempt, 'scroll to the first attempt');
  await attempt.click();
  await clock.step('click', 'the first attempt');
  const said = page.locator('[data-network-said]').first();
  await said.waitFor({ timeout: STEP_TIMEOUT_MS });
  await bring(said, 'scroll to what the network said', 1000);
  await clock.step('wait', 'the network refusal on screen');
  return (await said.textContent())?.trim() ?? '';
}
