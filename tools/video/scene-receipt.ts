// The receipt scene: the status page of the Bring in crossing recorded in the `in` scene, opened again later on the
// same built server and database, so the page shows the conversion that the network kept. Used when the first
// conversion of that crossing was dropped and the landing finisher converted the coins again (ADR 0080). No payment.
import { livePatch } from '../../core/route-assets.js';
import type { SampanConfig } from '../../core/config.js';
import { startServer, waitHealthy } from '../measure/server.js';
import type { SceneValue } from './scene-live.js';
import { txidsFromLinks } from './shots.js';
import type { Take } from './take.js';

export interface ReceiptDeps {
  config: SampanConfig;
  /** Path of the crossing status page, `/c/<id>`, from the `in` shot. */
  receipt: string;
  /** The asset the `in` scene opened on the local server, so the page reads the same as it did then. */
  asset: string;
  port: number;
  dataDir: string;
}

export async function receiptScene(t: Take, d: ReceiptDeps): Promise<SceneValue> {
  if (!/^\/c\/[0-9a-f]{32}$/.test(d.receipt)) throw new Error(`not a crossing status path: ${d.receipt}`);
  const base = `http://127.0.0.1:${d.port}`;
  const server = startServer({
    port: d.port,
    dataDir: d.dataDir,
    patch: { compliance: { crossChainEnabled: true }, ...livePatch(d.config.thorchain.assets, [d.asset]), features: { landing: true } },
  });
  try {
    await waitHealthy(base);
    const { page } = t;
    await page.goto(`${base}${d.receipt}`, { waitUntil: 'load' });
    const links = page.locator('main a[href*="://"]');
    await links.first().waitFor({ timeout: 30_000 });
    t.mark('landing status page: converted');
    await t.dwell(8000);
    const hrefs = await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    return { txids: txidsFromLinks(hrefs), receipt: d.receipt };
  } finally {
    server.kill();
  }
}
