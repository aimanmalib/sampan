// Wiring: one place decides between the real network and the fake one (SAMPAN_FAKE=1).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CashPrefix } from '../core/address.js';
import { publicConfig, type SampanConfig } from '../core/config.js';
import { poolV0LockingHex } from '../core/pools/template.js';
import { ElectrumChain } from './chain/electrum.js';
import { FakeChain } from './chain/fake.js';
import type { Chain } from './chain/types.js';
import { ClientIp } from './client-ip.js';
import { Db } from './db.js';
import { LandingService } from './landing/service.js';
import { LandingWatcher } from './landing/watcher.js';
import { DemoOrders } from './pay/demo.js';
import { fakeTransport } from './pay/fake.js';
import { PayService } from './pay/service.js';
import { feeWalletFrom } from './pay/spread.js';
import { httpsTransport, systemLookup, type Lookup, type Transport } from './pay/ssrf.js';
import { WebhookDispatcher } from './pay/webhook.js';
import { httpFetchActive, PoolDirectory, type FetchActive, type IndexerPool } from './indexer.js';
import { refreshPools } from './pools.js';
import { RateLimiter } from './rate.js';
import { Scanner } from './scan.js';
import { OutService } from './out.js';
import { createRoute } from './routes/index.js';
import type { Route } from './routes/types.js';
import { SwapService } from './swap.js';
import { InService } from './in.js';
import { HealthMonitor } from './health.js';
import { markOwnRows, testLocksOf } from './origin.js';
import { downChain, downIndexer, type Outage } from './outage.js';

export interface Services {
  prefix: CashPrefix;
  chain: Chain;
  pools: PoolDirectory;
  scanner: Scanner;
  swaps: SwapService;
  /** The active cross-chain route and "Send out", or null when route.active is none. */
  route: Route | null;
  outs: OutService | null;
  ins: InService | null;
  landings: LandingService;
  /** In-process finisher for landing addresses; started by the app. */
  watcher: LandingWatcher;
  /** Sampan Pay invoices (landing addresses whose owner is a merchant); reads what the watcher reports. */
  pay: PayService;
  /** Sampan Pay webhooks: queued in SQLite, checked against the network, sent signed (started by the app). */
  webhooks: WebhookDispatcher;
  /** Orders of the demo shop, fulfilled by its own webhook. */
  demoOrders: DemoOrders;
  db: Db;
  clientIp: ClientIp;
  limiter: RateLimiter;
  /** Last health check of the indexer, the BCH servers and the route (started by the app). */
  health: HealthMonitor;
  /** Locking bytecodes (hex) of the project's own test wallet. */
  testLocks: Set<string>;
  /** Fake network only: the app hands its in-process request function here so the demo shop's webhook is answered
   *  by the demo hook of the same server (server/pay/fake.ts). Nothing leaves the machine. */
  fakeDelivery: { inject?: LocalPost };
}

/** POST to a path of this same server; resolves to the HTTP status. */
export type LocalPost = (path: string, headers: Record<string, string>, body: string) => Promise<number>;

export interface ServiceOptions {
  config: SampanConfig;
  fake: boolean;
  /** File for SQLite, or ':memory:'. */
  dbFile: string;
  trustedProxies: string[];
  /** Extra team wallet addresses from the host (SAMPAN_TEST_ADDRESSES). */
  testAddresses?: string[];
  /** Transaction ids of the team's own measured runs (docs/MEASURED.md, set at build). */
  teamTxids?: string[];
  /** Frozen indexer capture used by the fake network. */
  fakeFixture?: string;
  /** SAMPAN_FAKE_OUTAGE: with the fake network, the indexer or the BCH servers fail (server/outage.ts). */
  outage?: Outage | null;
  /** The fee wallet key, used only when pay.spreadBps > 0. */
  spreadKey?: string | undefined;
  log?: (message: string) => void;
  /** Webhook DNS and sending (tests). The fake network answers every name with a documentation address and sends nothing. */
  webhookLookup?: Lookup;
  webhookTransport?: Transport;
}

/** Fake wallet balance handed to the first address of a scan that has never been seen. */
export const FAKE_WALLET = { sats: 2_000_000n, tokenSats: 1000n, tokens: 10_000n } as const;

export function fakeNetwork(
  config: SampanConfig,
  fixtureFile: string,
): { chain: FakeChain; fund: (lock: string) => void; fetchActive: FetchActive } {
  const fixture = JSON.parse(readFileSync(fixtureFile, 'utf8')) as { active: IndexerPool[] };
  const category = config.tokens[config.defaultToken]!.category;
  const chain = new FakeChain();
  for (const p of fixture.active) {
    chain.add(poolV0LockingHex(p.owner_pkh), {
      txid: p.txid,
      vout: p.tx_pos,
      sats: BigInt(p.sats),
      height: 1,
      token: { category, amount: BigInt(p.tokens) },
    });
  }
  let n = 0;
  const fund = (lock: string): void => {
    if (chain.historyOf(lock) > 0) return;
    n += 1;
    const txid = (n.toString(16).padStart(8, '0') + 'fa'.repeat(28)).slice(0, 64);
    chain.add(lock, { txid, vout: 0, sats: FAKE_WALLET.sats, height: 1 });
    chain.add(lock, { txid, vout: 1, sats: FAKE_WALLET.tokenSats, height: 1, token: { category, amount: FAKE_WALLET.tokens } });
  };
  return { chain, fund, fetchActive: async () => fixture.active };
}

export function createServices(o: ServiceOptions): Services {
  const { config } = o;
  const prefix: CashPrefix = 'bitcoincash';
  let chain: Chain;
  let fetchActive: FetchActive;
  let beforeFirstScan: ((lock: string) => void) | undefined;
  if (o.fake) {
    const fake = fakeNetwork(config, o.fakeFixture ?? path.resolve('tests/fixtures/cauldron-pusd-pools.json'));
    chain = o.outage === 'electrum' ? downChain() : fake.chain;
    fetchActive = o.outage === 'indexer' ? downIndexer : fake.fetchActive;
    beforeFirstScan = fake.fund;
  } else {
    chain = new ElectrumChain(config.electrum.servers, { log: o.log });
    fetchActive = httpFetchActive();
  }
  const pools = new PoolDirectory({ indexers: config.cauldron.indexers, cacheSeconds: config.cauldron.cacheSeconds, fetchActive, chain });
  const scanner = new Scanner({
    chain,
    prefix,
    gapLimit: config.wallet.gapLimit,
    maxAddresses: config.wallet.maxAddressesPerScan,
    cacheSeconds: config.wallet.scanCacheSeconds,
    beforeFirstScan,
  });
  const testLocks = testLocksOf([...config.ops.testAddresses, ...(o.testAddresses ?? [])], prefix);
  const db = new Db(o.dbFile);
  const moved = markOwnRows(db, testLocks, prefix, new Set(o.teamTxids ?? []));
  if (moved > 0) o.log?.(`origin: ${moved} rows from team wallets counted as test`);
  const swaps = new SwapService({ config, chain, pools, prefix });
  const route = createRoute(config, o.fake);
  const landings = new LandingService({ config, chain, pools, db, prefix, testLocks });
  // The fake network sends no webhook anywhere: names resolve to TEST-NET-3 and the transport answers 503 (nothing
  // leaves), except the demo shop's own hook, which goes to this server in-process (server/pay/fake.ts).
  const fakeDelivery: Services['fakeDelivery'] = {};
  const webhookLookup: Lookup = o.webhookLookup ?? (o.fake ? async () => ['203.0.113.10'] : systemLookup);
  const webhookTransport: Transport = o.webhookTransport ?? (o.fake ? fakeTransport(config, fakeDelivery) : httpsTransport);
  const pay = new PayService({ config, db, pools, prefix, testLocks, lookup: webhookLookup });
  const category = config.tokens[config.defaultToken]!.category;
  const routeChains = publicConfig(config).routeChains;
  const health = new HealthMonitor({
    pools: async () => (await pools.active(category)).length,
    tipHeight: () => chain.tipHeight(),
    ...(route && config.compliance.crossChainEnabled ? { route: { id: route.id, open: () => route.open(routeChains) } } : {}),
    intervalMs: config.ops.healthIntervalSeconds * 1000,
    retryMs: config.ops.healthRetrySeconds * 1000,
    log: o.log,
  });
  return {
    prefix,
    chain,
    pools,
    scanner,
    swaps,
    route,
    outs: route ? new OutService({ config, route, swaps, chain, prefix }) : null,
    ins: route ? new InService({ config, route, landings, prefix }) : null,
    landings,
    watcher: new LandingWatcher({
      config,
      db,
      chain,
      loadPools: async (category) => refreshPools(chain, await pools.active(category)),
      log: o.log,
      onResults: (row, results) => pay.observe(row, results),
      spread: feeWalletFrom(config, chain, o.spreadKey),
    }),
    pay,
    webhooks: new WebhookDispatcher({ config, db: db.handle, pay, chain, prefix, lookup: webhookLookup, transport: webhookTransport, log: o.log }),
    demoOrders: new DemoOrders(db.handle),
    fakeDelivery,
    db,
    clientIp: new ClientIp({ trustedProxies: o.trustedProxies, cloudflareCidrs: config.rate.cloudflareCidrs, log: o.log }),
    limiter: new RateLimiter(),
    health,
    testLocks,
  };
}
