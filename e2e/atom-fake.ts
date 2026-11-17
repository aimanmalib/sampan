// The atomic swap service as the e2e runs answer it: frozen fixtures (tests/fixtures/atom) through page.route, the
// route switched on in the config the page reads, and a record of what the page asked and logged. Shared by the
// route card specs (e2e/atom.spec.ts, e2e/oneclick.spec.ts).
import { readFileSync } from 'node:fs';
import { expect, type Page, type Route } from '@playwright/test';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../tests/fixtures/atom/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
export const HEALTH = fixture('health.json');
const QUOTES: Record<string, Record<string, unknown>> = {
  'pusd-to-usdc': fixture('quote-pusd-to-usdc.json'),
  'usdc-to-pusd': fixture('quote-usdc-to-pusd.json'),
};
export const INVENTORY = fixture('quote-pusd-to-usdc-inventory.json');

export interface Seen {
  atom: string[];
  client: string[];
  errors: string[];
  info: string[];
}

/** Records every request to the service and the client file, and console errors. */
export function watch(page: Page): Seen {
  const seen: Seen = { atom: [], client: [], errors: [], info: [] };
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/atom/api')) seen.atom.push(path);
    if (path.startsWith('/vendor/atom-client')) seen.client.push(path);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') seen.errors.push(m.text());
    if (m.type() === 'info') seen.info.push(m.text());
  });
  page.on('pageerror', (e) => seen.errors.push(e.message));
  return seen;
}

/** Turns the route on in the config the page reads, for both flows. */
export async function routeOn(page: Page): Promise<void> {
  await page.route('**/api/config', async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { features: Record<string, boolean>; atom: { flows: string[] } };
    body.features.atom = true;
    body.atom.flows = ['usdc-to-pusd', 'pusd-to-usdc'];
    await route.fulfill({ response: res, json: body });
  });
}

/** Answers the service from fixtures; each quote echoes the amount asked, as the service does. */
export async function service(page: Page, opts: { health?: Record<string, unknown>; quote?: (flow: string) => Record<string, unknown> } = {}): Promise<void> {
  await page.route('**/atom/api/**', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/health')) return route.fulfill({ json: opts.health ?? HEALTH });
    if (url.pathname.endsWith('/quote')) {
      const flow = url.searchParams.get('flow') ?? '';
      const q = { ...(opts.quote ?? ((f: string) => QUOTES[f]!))(flow) };
      const status = q.ok ? 200 : 422;
      if (q.ok) q.amountIn = url.searchParams.get('amount');
      return route.fulfill({ status, json: q });
    }
    return route.fulfill({ status: 404, json: { error: 'not-found' } });
  });
}

export const routes = (page: Page) => page.locator('fieldset.routes');
export const row = (page: Page, name: string) => page.locator(`.routes__row[data-route="${name}"]`);
export const primary = (page: Page) => page.locator('.button--primary');

export async function noHorizontalOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
}
