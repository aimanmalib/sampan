// K6P6 on the page the live site shows (fake server with the shipped flows): the line by the card names the newest ok
// stablecoin crossing into PUSD in docs/MEASURED.md, as core/hero-proof.ts picks it, with both transactions opening in
// the explorers config names and a link to the table of every run. The card still opens on the tab config.ui.heroTab names.
import { expect, test } from '@playwright/test';
import shipped from '../config/sampan.json' with { type: 'json' };
import en from '../lang/en.json' with { type: 'json' };
import { heroProof } from '../core/hero-proof.js';
import { measuredJson } from '../scripts/measured-json.js';
import { SHIPPED_PORT_OFFSET } from '../playwright.config.js';

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the fake server with the shipped flows');
test.skip(shipped.ui.heroProof === 'none', 'config draws no proof line');
test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + SHIPPED_PORT_OFFSET}` });

test('the proof line shows the newest real crossing with its two transactions', async ({ page }) => {
  const run = heroProof(measuredJson(), shipped.route.symbols, 'latest-in');
  expect(run, 'MEASURED.md has an ok stablecoin crossing into PUSD').not.toBeNull();
  const chain = shipped.evm.chains.find((c) => c.key.toLowerCase() === run!.chain)!;
  await page.addInitScript(() => localStorage.setItem('sampan.lang', 'en'));
  await page.goto('/');
  const line = page.locator('.hero-proof');
  await expect(line).toHaveAttribute('data-hero-proof', run!.bch.id);
  await expect(line).toContainText(en['heroProof.label']);
  await expect(line).toContainText(`${run!.amount} ${run!.symbol} from ${chain.name} to PUSD`);
  await expect(line.locator(`a[href="${shipped.connect.explorerTxUrl.replace('{txid}', run!.bch.id)}"]`)).toHaveText('BCH tx');
  await expect(line.locator(`a[href="${chain.explorer}/tx/${run!.evm.id}"]`)).toHaveText(`${run!.symbol} tx`);
  await expect(line.locator('a[href="/how#proof"]')).toHaveText(en['heroProof.all']);
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', `tab-${shipped.ui.heroTab}`);
});
