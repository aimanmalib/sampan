// Measured Sampan Pay invoices on mainnet (PAY4, KP30), against the built server on this host.
//   npx tsx tools/measure/pay.ts [--runs 2] [--port 4186]
//   npx tsx tools/measure/pay.ts --live [--runs 1]
// Starts dist/ with features.pay on and private webhook targets allowed (local only), and a small HTTPS webhook
// receiver on 127.0.0.1 with a throwaway self-signed certificate that only the spawned server trusts. Each run makes
// an invoice of pay.demo.priceUsd for pay.demo.merchantAddress (a test wallet address), pays the exact amount from
// the test wallet as a plain BCH payment (tools/test-wallet/send.ts), then waits for the signed webhook.
// `seconds` runs from the payment broadcast to the receiver checking the webhook signature.
// --live (PAY5): no local server or receiver. Each run is a demo shop order on the public site (POST
// /api/pay/demo/order, the button on /pay), so the webhook goes out through the public URL to the site's own demo
// hook, which hands the order over only after checking the signature; the run reads that hand-over (time and event)
// from GET /api/pay/demo/order/:id.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseAddress } from '../../core/address.js';
import { hdKeysFromPhrase } from '../../core/client/session.js';
import { deriveAddress, formatUnits } from '../../core/wallet.js';
import { ElectrumChain } from '../../server/chain/electrum.js';
import { loadConfig } from '../../server/config.js';
import { checkWebhook } from '../../server/pay/sign.js';
import { SECRET_KEYS, parseEnv } from '../test-wallet/keys.js';
import { appendPayNote, payNote, payRun, type HookReceipt, type PayFacts, type PayInvoiceView } from './pay-run.js';
import { appendRuns } from './runs.js';
import { startServer, waitHealthy } from './server.js';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const LIVE = process.argv.includes('--live');
const RUNS = Number(arg('--runs', LIVE ? '1' : '2'));
const PORT = Number(arg('--port', '4186'));
const HOOK_PORT = PORT + 1;
const config = loadConfig('config/sampan.json');
const BASE = LIVE ? config.site.url : `http://127.0.0.1:${PORT}`;
const HOOK_URL = `https://127.0.0.1:${HOOK_PORT}/hook`;
const MEASURED = 'docs/MEASURED.md';
const WAIT_MS = 15 * 60_000;
const HOOK_TOLERANCE_SECONDS = 300;

const token = config.tokens[config.defaultToken]!;
const category = token.category.toLowerCase();
const usd = config.pay.demo.priceUsd;
const merchant = config.pay.demo.merchantAddress;

// Public addresses only: the phrase stays in this process and in the test wallet's.
const env = parseEnv(readFileSync(path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env'), 'utf8'));
const phrase = env.get(SECRET_KEYS.bchMainnet);
if (!phrase) throw new Error(`${SECRET_KEYS.bchMainnet} is missing from the env file`);
const keys = hdKeysFromPhrase(phrase);
const receive = Array.from({ length: 25 }, (_, i) => deriveAddress(keys.publicKey('receive', i), 'receive', i, 'bitcoincash'));
const merchantKey = receive.find((a) => a.tokenAddress === merchant);
if (!merchantKey) throw new Error('pay.demo.merchantAddress is not a receive address of the test wallet');

const secret = `whsec_${randomBytes(32).toString('base64')}`;
const hooks: HookReceipt[] = [];

function certificate(dir: string): { key: string; cert: string; certFile: string } {
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyFile, '-out', certFile], { stdio: 'ignore' });
  return { key: readFileSync(keyFile, 'utf8'), cert: readFileSync(certFile, 'utf8'), certFile };
}

/** The merchant's webhook endpoint: records every message with the result of the signature check. */
function receiver(tls: { key: string; cert: string }) {
  return createServer(tls, (req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      const bad = checkWebhook(secret, req.headers, body, Math.floor(Date.now() / 1000), HOOK_TOLERANCE_SECONDS);
      let msg: { type?: string; data?: { id?: string } } = {};
      try {
        msg = JSON.parse(body) as typeof msg;
      } catch {
        /* recorded as unverified below */
      }
      hooks.push({ verified: bad === null, type: msg.type ?? '', invoiceId: msg.data?.id ?? '', receivedAt: Date.now() });
      res.writeHead(bad === null ? 200 : 401).end();
    });
  }).listen(HOOK_PORT, '127.0.0.1');
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json()) as T;
  if (!res.ok) throw new Error(`${url}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

function sendPlain(address: string, bch: string): Promise<string | undefined> {
  const send = spawn(process.execPath, ['--import', 'tsx', 'tools/test-wallet/send.ts', address, bch, '--usd', String(usd), '--why', `Pay a ${usd.toFixed(2)} USD Sampan Pay invoice`], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let out = '';
  send.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
  return new Promise((r) => send.on('exit', (code) => r(code === 0 ? /txid ([0-9a-f]{64})/.exec(out)?.[1] : undefined)));
}

/** Live: the demo hook of the site checked the signature before it handed the order over. */
async function liveHook(id: string): Promise<void> {
  const o = await json<{ fulfilled: boolean; fulfilledAt: string | null; event: string | null }>(`${BASE}/api/pay/demo/order/${id}`);
  if (o.fulfilled && o.fulfilledAt && !hooks.some((h) => h.invoiceId === id)) {
    hooks.push({ verified: true, type: o.event ?? '', invoiceId: id, receivedAt: Date.parse(o.fulfilledAt) });
  }
}

async function waitDone(id: string): Promise<{ view: PayInvoiceView; hook: HookReceipt | undefined }> {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const view = await json<PayInvoiceView>(`${BASE}/api/pay/invoice/${id}`);
    if (LIVE) await liveHook(id);
    const hook = hooks.find((h) => h.invoiceId === id && h.verified);
    // The receiver sees the message just before the server records the answer, so wait for both.
    if ((hook && view.webhook.state === 'delivered') || Date.now() > until || view.webhook.state === 'failed') return { view, hook: hook ?? hooks.find((h) => h.invoiceId === id) };
    await new Promise((r) => setTimeout(r, LIVE ? 3000 : 1000));
  }
}

async function onChain(chain: ElectrumChain, txid: string | undefined): Promise<boolean> {
  return txid !== undefined && (await chain.transaction(txid)) !== null;
}

async function tokensAtMerchant(chain: ElectrumChain, txid: string | undefined): Promise<bigint | undefined> {
  if (!txid) return undefined;
  for (let i = 0; i < 10; i++) {
    const hit = (await chain.listUnspent(merchantKey!.lockingHex)).find((u) => u.txid === txid && u.vout === 0);
    if (hit) return hit.token?.category.toLowerCase() === category ? hit.token.amount : undefined;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return undefined;
}

async function oneRun(chain: ElectrumChain, n: number): Promise<PayFacts> {
  const facts: PayFacts = { usd, how: 'plain', where: LIVE ? 'live' : 'local', utc: new Date(), onChain: { pay: false, convert: false } };
  const post = (url: string, body: unknown) => json<{ id: string }>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const made = LIVE
    ? await post(`${BASE}/api/pay/demo/order`, {})
    : await post(`${BASE}/api/pay/invoice`, { usd, merchantAddress: merchant, webhookUrl: HOOK_URL, webhookSecret: secret, orderId: `measure-${Date.now()}-${n}` });
  // The PUSD output is checked at pay.demo.merchantAddress below, so a site paying another merchant is a fail row.
  const inv = await json<{ id: string; address: string; requiredSats: string }>(`${BASE}/api/pay/invoice/${made.id}`);
  if (typeof parseAddress(inv.address, 'bitcoincash') === 'string') throw new Error(`the invoice address does not parse: ${inv.address}`);
  const bch = formatUnits(BigInt(inv.requiredSats), 8, 8);
  console.log(`invoice ${inv.id}: ${bch} BCH to ${inv.address}`);
  facts.utc = new Date();
  const txid = await sendPlain(inv.address, bch);
  if (!txid) return { ...facts, view: await json<PayInvoiceView>(`${BASE}/api/pay/invoice/${inv.id}`) };
  facts.payTxid = txid;
  facts.paidAt = Date.now();
  const { view, hook } = await waitDone(inv.id);
  const convert = view.convert[0]?.txid;
  return {
    ...facts,
    view,
    ...(hook ? { hook } : {}),
    onChain: { pay: await onChain(chain, txid), convert: await onChain(chain, convert) },
    ...(await tokensAtMerchant(chain, convert).then((t) => (t === undefined ? {} : { tokensAtMerchant: t }))),
  };
}

/** Local: a built server with private webhook targets allowed and an HTTPS receiver. Live: nothing to start. */
function startLocal(): { stop: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'sampan-pay-'));
  const tls = certificate(dir);
  const hookServer = receiver(tls);
  const server = startServer({
    port: PORT,
    dataDir: 'state/measure-pay',
    patch: {
      features: { pay: true },
      pay: { webhook: { allowPrivate: true } },
      ops: { testAddresses: receive.map((a) => a.address) },
    },
    env: { NODE_EXTRA_CA_CERTS: tls.certFile },
  });
  return {
    stop: () => {
      server.kill();
      hookServer.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function main(): Promise<void> {
  const local = LIVE ? undefined : startLocal();
  const chain = new ElectrumChain(config.electrum.servers);
  try {
    if (local) await waitHealthy(BASE);
    for (let n = 1; n <= RUNS; n++) {
      const facts = await oneRun(chain, n);
      const run = payRun(facts);
      appendRuns(MEASURED, [run]);
      appendPayNote(MEASURED, payNote(facts));
      console.log(`pay: ${run.ok ? 'ok' : 'fail'} ${run.txid ?? ''} ${run.note ?? ''} ${run.seconds?.toFixed(1) ?? '-'} s`);
      if (!run.ok) break;
    }
  } finally {
    await chain.close();
    local?.stop();
  }
}

void main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
