// The page's crossing claims come from config (K6P1, ADR 0083), on the fake server with the shipped config and the
// route reported open on every chain: /how "What Sampan adds" lists per direction exactly the assets core/route-claims
// makes of /api/config, each hero chip says open, send out only or bring in only from the same claims, and the hero
// line names every route that carries one. A config answer with Avalanche's Bring in switched off drops Avalanche
// from Bring in and makes its chip "send out only". Skipped against a live site.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import { chipKey, claimsFor, liveRoutes, routeClaims, type ClaimOffer } from '../core/route-claims.js';
import { SHIPPED_PORT_OFFSET } from '../playwright.config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server with the shipped config');
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + SHIPPED_PORT_OFFSET}` });

type Cfg = ClaimOffer & { routeAssets: Array<{ chain: string; symbol: string; live: { out: boolean; in: boolean } }> };

/** Every chain open in the health report; the config answer passed through `edit`. */
async function serve(page: Page, edit: (c: Cfg) => Cfg = (c) => c): Promise<() => Cfg> {
  let seen: Cfg | null = null;
  await page.route('**/api/health', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { checkedAt?: string | null; route: Record<string, unknown> | null };
    const chains = { BCH: true, ETH: true, BSC: true, AVAX: true, BASE: true, TRON: true };
    body.route = { ...(body.route ?? {}), open: true, chains };
    await route.fulfill({ response: res, json: body });
  });
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    seen = edit((await res.json()) as Cfg);
    await route.fulfill({ response: res, json: seen });
  });
  return () => seen!;
}

const chainOf = (c: ClaimOffer, name: string) => c.evm.chains.find((x) => x.name === name)!.key;

async function expectClaims(page: Page, cfg: Cfg): Promise<void> {
  const claims = routeClaims(cfg);
  await page.goto('/how');
  for (const dir of ['in', 'out'] as const) {
    const item = page.locator(`[data-adds="${dir}"]`);
    const reach = claimsFor(claims, dir);
    await expect(item).toHaveCount(reach.length > 0 ? 1 : 0);
    for (const r of reach) for (const name of r.chains) await expect(item).toContainText(name);
    const absent = claims.filter((c) => c[dir].length === 0).map((c) => c.name);
    for (const name of absent) await expect(item).not.toContainText(name);
  }
  const nodes = page.locator('.diagram__step--contract [data-node]');
  const routes = liveRoutes(claims).map((r) => en[`route.${r}` as keyof typeof en]);
  if (routes.length > 0) await expect(nodes.filter({ hasText: routes[0] }).first()).toBeVisible();
  await page.goto('/');
  const chips = page.getByRole('list', { name: en['hero.chips.label'] });
  for (const c of claims) {
    const text = en[chipKey(c)].replace('{name}', c.name);
    await expect(chips.locator(`[data-chip="chain-${chainOf(cfg, c.name)}"]`)).toHaveText(text);
  }
  const honest = page.locator('.hero__honest');
  for (const r of routes) await expect(honest).toContainText(r);
}

test('the shipped config: /how, the chips and the hero line say what the config marks live', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cfg = await serve(page);
  await page.goto('/how');
  await expect(page.locator('[data-adds]').first()).toBeVisible();
  await expectClaims(page, cfg());
  expect(errors).toEqual([]);
});

test('Avalanche Bring in switched off: Avalanche leaves Bring in and its chip says send out only', async ({ page }) => {
  const cfg = await serve(page, (c) => ({ ...c, routeAssets: c.routeAssets.map((a) => (a.chain === 'AVAX' ? { ...a, live: { ...a.live, in: false } } : a)) }));
  await page.goto('/how');
  await expect(page.locator('[data-adds="in"]')).toBeVisible();
  const c = cfg();
  const avax = routeClaims(c).find((x) => x.key === 'AVAX');
  test.skip(!avax || avax.out.length === 0, 'the shipped config sends out to Avalanche');
  await expect(page.locator('[data-adds="in"]')).not.toContainText(avax!.name);
  await expectClaims(page, c);
  await expect(page.locator('[data-chip="chain-AVAX"]')).toHaveText(en['hero.chip.outOnly'].replace('{name}', avax!.name));
});
