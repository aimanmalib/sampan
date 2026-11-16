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
  db: Db;
  clientIp: ClientIp;
  limiter: RateLimiter;
  /** Last health check of the indexer, the BCH servers and the route (started by the app). */
  health: HealthMonitor;
  /** Locking bytecodes (hex) of the project's own test wallet. */
  testLocks: Set<string>;
}

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
  log?: (message: string) => void;
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
    chain = fake.chain;
    fetchActive = fake.fetchActive;
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
    }),
    db,
    clientIp: new ClientIp({ trustedProxies: o.trustedProxies, cloudflareCidrs: config.rate.cloudflareCidrs, log: o.log }),
    limiter: new RateLimiter(),
    health,
    testLocks,
  };
}
