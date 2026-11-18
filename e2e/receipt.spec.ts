// The receipt on a finished crossing's page (/c/:id), out and in, from synthetic crossings (tests/fixtures/receipt)
// served in place of GET /api/crossings/:id on the fake server with cross-chain on. Every explorer link is checked
// against the hosts in /api/config; the full ids, the amounts, the cost and the time are shown; nothing overflows.
import { expect, test, type Page } from '@playwright/test';
import en from '../lang/en.json' with { type: 'json' };
import outFixture from '../tests/fixtures/receipt/out.json' with { type: 'json' };
import inFixture from '../tests/fixtures/receipt/in.json' with { type: 'json' };

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server');

const outPort = Number(process.env.E2E_PORT ?? 4173) + 2;
test.use({ baseURL: `http://127.0.0.1:${outPort}` });

interface PageConfig {
  connect: { explorerTxUrl: string };
  routeExplorerTxUrl: string;
  evm: { chains: Array<{ key: string; name: string; explorer: string }> };
}

async function open(page: Page, fixture: typeof outFixture | typeof inFixture): Promise<{ errors: string[]; config: PageConfig }> {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route(`**/api/crossings/${fixture.id}`, (route) => route.fulfill({ json: fixture }));
  const config = (await (await page.request.get('/api/config')).json()) as PageConfig;
  await page.goto(`/c/${fixture.id}`);
  await expect(page.getByTestId('receipt')).toBeVisible();
  return { errors, config };
}

async function noOverflow(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
}

const hrefOf = (c: PageConfig, chain: string, id: string): string => {
  const bare = id.replace(/^0x/i, '').toLowerCase();
  if (chain === 'BCH') return c.connect.explorerTxUrl.replace('{txid}', bare);
  if (chain === 'THOR') return c.routeExplorerTxUrl.replace('{txid}', bare);
  return `${c.evm.chains.find((x) => x.key === chain)!.explorer}/tx/0x${bare}`;
};

for (const [name, fixture, symbols] of [
  ['out', outFixture, ['0.014 BCH', '2.67 USDC']],
  ['in', inFixture, ['1.80 USDC', '0.00835993 BCH']],
] as const) {
  test(`a finished crossing ${name} shows its receipt: each transaction in full with its link, amounts, cost and time`, async ({ page }) => {
    const { errors, config } = await open(page, fixture);
    const receipt = page.getByTestId('receipt');
    await expect(receipt.getByRole('heading', { name: en['receipt.title'] })).toBeVisible();
    const links = receipt.locator('a.receipt__txid');
    await expect(links).toHaveCount(fixture.out.receipt.legs.length);
    for (const [i, leg] of fixture.out.receipt.legs.entries()) {
      const link = links.nth(i);
      await expect(link).toHaveAttribute('href', hrefOf(config, leg.chain, leg.txid));
      const bare = leg.txid.toLowerCase();
      await expect(link).toHaveText(leg.chain === 'BCH' || leg.chain === 'THOR' ? bare : `0x${bare}`);
    }
    await expect(receipt.locator('.receipt__chain').nth(1)).toHaveText(en['receipt.chain.thor']);
    await expect(page.getByTestId('receipt-paid')).toContainText(symbols[0]);
    await expect(page.getByTestId('receipt-received')).toContainText(symbols[1]);
    await expect(page.getByTestId('receipt-cost')).toHaveText(
      en['receipt.costKept'].replace('{usd}', `USD ${(Number(fixture.out.receipt.costUsd) / 1e6).toFixed(2)}`).replace('{pct}', fixture.out.receipt.keepPct.toFixed(2)),
    );
    await expect(page.getByTestId('receipt-time')).toHaveText(en['receipt.minutes'].replace('{n}', String(Math.round(fixture.out.receipt.seconds / 60))));
    // The short transaction lines above give way to the receipt's full ids.
    await expect(page.locator('.timeline__out')).toHaveCount(0);
    await noOverflow(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await noOverflow(page);
    const box = await receipt.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(errors).toEqual([]);
  });
}

test('a crossing still on its way has no receipt', async ({ page }) => {
  const waiting = { ...outFixture, status: 'broadcast', out: { stage: 'pending', outTxid: null, outChain: null, receipt: null } };
  await page.route(`**/api/crossings/${waiting.id}`, (route) => route.fulfill({ json: waiting }));
  await page.goto(`/c/${waiting.id}`);
  await expect(page.locator('.crossing__kind')).toHaveText(en['crossing.kind.out']);
  await expect(page.locator('.crossing__status')).toBeVisible();
  await expect(page.getByTestId('receipt')).toHaveCount(0);
});
