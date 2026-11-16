// Addresses that do not exist: a page path opens the app, a missing file gets the static page in every language
// (404, no stack trace), and a missing API route answers JSON. Runs locally and against the live site (deploy.sh).
import { expect, test } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };

const STACK = /\bat \S+ \(|node_modules|\.ts:\d+/;

test('an unknown page path opens the front page without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(en['hero.title']);
  expect(errors).toEqual([]);
});

test('a missing file gets the static not-found page, readable at 320 px', async ({ page, request }) => {
  const res = await request.get('/no-such-file.js');
  expect(res.status()).toBe(404);
  expect(res.headers()['content-type']).toContain('text/html');
  const body = await res.text();
  expect(body).toContain(en['error.page.notFound']);
  expect(body).not.toMatch(STACK);

  await page.setViewportSize({ width: 320, height: 640 });
  // The browser logs the 404 of the document itself; script errors or a blocked style would show up here.
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && !/status of 404/.test(msg.text()) && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/no-such-file.js');
  await expect(page.getByRole('heading', { name: en['error.page.notFound'] })).toBeVisible();
  await expect(page.getByRole('link', { name: en['error.page.home'] }).first()).toHaveAttribute('href', '/');
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
  expect(errors).toEqual([]);
});

test('a missing API route answers JSON, not a page or a stack trace', async ({ request }) => {
  const res = await request.get('/api/no-such-route');
  expect(res.status()).toBe(404);
  expect(res.headers()['content-type']).toContain('application/json');
  expect(await res.json()).toEqual({ error: 'not_found' });
});
