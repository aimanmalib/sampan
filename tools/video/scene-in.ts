// The Bring in scene: a real mainnet crossing (a stablecoin on another chain arriving as PUSD at a landing address)
// driven through the page itself. The page is the built server of this commit on this host, with that one asset
// switched on for Bring in (the live site opens an asset only after its measured runs, gerbang §7i); the crossing,
// THORChain and both chains are mainnet. The EVM side is the EVM test key behind an EIP-6963 stand-in: the page asks,
// this process signs (the key never enters the page). The crossing is traced in parallel and becomes one Runs row.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Hex } from 'viem';
import { parseAddress } from '../../core/address.js';
import { makeApi } from '../../core/client/api.js';
import { quoteIn } from '../../core/client/in.js';
import { livePatch } from '../../core/route-assets.js';
import { parseUnits } from '../../core/wallet.js';
import type { ElectrumChain } from '../../server/chain/electrum.js';
import type { SampanConfig } from '../../core/config.js';
import { SECRET_KEYS, parseEnv } from '../test-wallet/keys.js';
import { record, spentOn } from '../test-wallet/ledger.js';
import { crossingAsset, traceCrossing } from '../measure/cross.js';
import { jsonRpcOver, keyProvider } from '../measure/evm-key-provider.js';
import { convertedTxid, inLabel, type LandingView } from '../measure/in-plan.js';
import { overBudget } from '../measure/out-plan.js';
import { traceDeps } from '../measure/run-cli.js';
import { startServer, waitHealthy } from '../measure/server.js';
import type { SceneValue } from './scene-live.js';
import { txidsFromLinks } from './shots.js';
import type { Take } from './take.js';

const LEDGER = 'state/test-ledger.jsonl';
export const WALLET_NAME = 'Test EVM wallet';
/** Approval and deposit, each waiting for its receipt (evm.receiptWaitSeconds at most). */
const SIGN_TIMEOUT_MS = 600_000;

/** The page side of the stand-in: announces a wallet whose every request goes to this process. */
export const EVM_BRIDGE = `(() => {
  const provider = {
    async request({ method, params }) {
      const r = await window.__sampanEvm(method, params ?? []);
      if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
      return r.result;
    },
    on() {},
    removeListener() {},
  };
  const icon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#444"/></svg>');
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: 'video-evm', name: '${WALLET_NAME}', icon, rdns: 'test.evm' }, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce);
})();`;

export interface InDeps {
  config: SampanConfig;
  en: Record<string, string>;
  chain: ElectrumChain;
  asset: string;
  amount: string;
  receive: string;
  owner: { address: string; tokenAddress: string; lockingHex: string };
  port: number;
}

export async function bringIn(t: Take, d: InDeps): Promise<SceneValue> {
  const entry = d.config.thorchain.assets.find((a) => a.asset === d.asset);
  if (!entry) throw new Error(`${d.asset} is not in config thorchain.assets`);
  const { chain: evmKey, rpc } = crossingAsset(d.config, d.asset);
  const evm = d.config.evm.chains.find((c) => c.key === evmKey)!;
  const amount = parseUnits(d.amount, 8)!;
  const env = parseEnv(readFileSync(path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env'), 'utf8'));
  const key = env.get(SECRET_KEYS.evm);
  if (!key) throw new Error('the env file needs the EVM test key');
  const provider = keyProvider({ key: key as Hex, chain: evm, rpc: jsonRpcOver(evm.rpc) });
  const base = `http://127.0.0.1:${d.port}`;
  const server = startServer({
    port: d.port,
    dataDir: 'state/video/server-data',
    patch: { compliance: { crossChainEnabled: true }, ...livePatch(d.config.thorchain.assets, [d.asset]), features: { landing: true }, ops: { testAddresses: [d.owner.address] } },
  });
  try {
    await waitHealthy(base);
    const api = makeApi((p, init) => fetch(`${base}${p}`, init));
    const quote = await quoteIn(api, { symbol: entry.symbol, chain: entry.chain, amount, receive: d.receive, address: d.owner.address });
    const usd = Math.round(quote.usd * 100) / 100;
    const budget = JSON.parse(readFileSync('state/budget.json', 'utf8')) as { maxUsdPerTx: number; maxUsdPerDay: number };
    const refused = overBudget(usd, spentOn(LEDGER, new Date().toISOString().slice(0, 10)), budget);
    if (refused) throw new Error(`budget: ${refused}`);
    const label = inLabel({ amount, symbol: entry.symbol, chain: entry.chain, receive: d.receive, landing: true }, BigInt(quote.minSats));

    const sent: Array<{ hash: string; at: Date }> = [];
    await t.page.exposeFunction('__sampanEvm', async (method: string, params: unknown[]) => {
      try {
        const result = await provider.request({ method, params });
        if (method === 'eth_sendTransaction') sent.push({ hash: String(result), at: new Date() });
        return { result };
      } catch (e) {
        return { error: { message: (e as Error).message, code: (e as { code?: number }).code ?? 4001 } };
      }
    });
    const { page } = t;
    await page.goto(base, { waitUntil: 'load' });
    await page.getByRole('tab', { name: d.en['tabs.in']! }).click();
    t.mark('Bring in');
    // With landing addresses open too, the tab first asks where the money comes from: the other chains.
    const sources = page.getByRole('radiogroup', { name: d.en['in.source']! });
    await sources.waitFor({ timeout: 10_000 }).catch(() => undefined);
    if (await sources.count()) await sources.getByRole('radio').last().click();
    await t.dwell(1500);
    const network = page.getByRole('group', { name: d.en['cross.network']! });
    await network.waitFor({ timeout: 10_000 }).catch(() => undefined);
    if (await network.count()) await network.getByRole('radio', { name: `${entry.symbol} on ${evm.name}` }).check();
    t.mark(`${entry.symbol} on ${evm.name} picked`);
    await page.getByRole('button', { name: WALLET_NAME }).click();
    await page.locator('.evm__who').waitFor({ timeout: 30_000 });
    t.mark(`${evm.name} wallet connected`);
    await page.locator('.in .field__input').first().pressSequentially(d.amount, { delay: 120 });
    await page.getByPlaceholder('bitcoincash:…').pressSequentially(d.owner.tokenAddress, { delay: 10 });
    await page.locator('.swap__receive').filter({ hasText: /At least [0-9.]+ BCH/ }).waitFor({ timeout: 60_000 });
    t.mark('quote and cost shown');
    await t.glide('.in .button--primary');
    await t.dwell(4000);
    await page.locator('.in .button--primary').click();
    const dialog = page.getByRole('dialog');
    const ok = dialog.getByRole('button', { name: d.en['disclose.ok']! });
    if (await ok.isVisible({ timeout: 5000 }).catch(() => false)) {
      await t.dwell(2500);
      await ok.click();
    }
    t.mark('the EVM wallet signs: approval, then deposit');
    await page.locator('.swap__done').or(page.locator('.swap__error[role="alert"]')).first().waitFor({ timeout: SIGN_TIMEOUT_MS });
    if (await page.locator('.swap__error[role="alert"]').isVisible()) throw new Error(`the page reports: ${await page.locator('.swap__error[role="alert"]').textContent()}`);
    const deposit = sent.at(-1);
    if (!deposit) throw new Error('the page sent no transaction');
    record(LEDGER, { utc: new Date().toISOString(), usd, prompt: `Bring in ${label} (demo video)` });
    t.mark('deposit sent');
    await t.dwell(3000);

    const landingHref = (await page.getByRole('link', { name: d.en['in.landingStatus']! }).getAttribute('href')) ?? '';
    const landingId = /\/c\/([0-9a-f]{32})/.exec(landingHref)?.[1];
    if (!landingId) throw new Error('no landing status link');
    const view = async () => (await fetch(`${base}/api/crossings/${landingId}`).then((r) => r.json())) as LandingView;
    const parsed = parseAddress((await view()).landing?.address ?? '', 'bitcoincash');
    if (typeof parsed === 'string') throw new Error(`the landing crossing names no address: ${parsed}`);
    const tracing = traceCrossing(
      { flow: 'in', chain: evmKey, firstTxid: deposit.hash, broadcastAt: deposit.at, amount: label, destination: parsed.lockingHex },
      { ...traceDeps(d.config, rpc, d.chain), convert: async (bchTxid: string) => convertedTxid(await view(), bchTxid) },
    );
    await page.getByRole('link', { name: d.en['swap.status']! }).click();
    t.mark('crossing status page');
    const run = await tracing;
    t.mark(run.ok ? 'BCH arrived and turned into PUSD' : `crossing ${run.note ?? 'failed'}`);
    await page.goto(`${base}/c/${landingId}`, { waitUntil: 'load' });
    t.mark('landing status page: converted');
    await t.dwell(7000);
    return { txids: run.txid ? txidsFromLinks([run.txid]) : [], receipt: `/c/${landingId}`, run };
  } finally {
    server.kill();
  }
}
