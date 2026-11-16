// The public landing finisher as a testable function. Given a recovery card it converts the BCH at the landing
// address to tokens for the owner when the Cauldron pools meet the contract minimum, otherwise returns the BCH once
// the coin is old enough. It talks only to the Electrum servers and Cauldron indexers listed in config/sampan.json,
// never to the Sampan site or its API: for a landing, the Sampan server is optional.
// scripts/finisher.ts is the thin wrapper that `npm run finisher` runs.
import { readCard } from '../core/landing-card.js';
import type { SampanConfig } from '../core/config.js';
import type { Chain } from '../server/chain/types.js';
import { PoolDirectory, type FetchActive } from '../server/indexer.js';
import { finishLanding, type FinishMode } from '../server/landing/finish.js';
import { refreshPools } from '../server/pools.js';

export const USAGE = `usage: npm run finisher -- <card.json> [--convert | --give-back] [--dry-run]

Finishes a Sampan landing from its recovery card (the JSON from the status page), without the Sampan server.
It reads the coins at the landing address from public Electrum servers and the pools from the public Cauldron
indexer, both listed in config/sampan.json, then broadcasts one transaction per coin.

  (no mode)     convert when the pools meet the contract minimum, else give the BCH back once it is old enough
  --convert     only convert
  --give-back   only give the BCH back (needs the coin to be returnAfter blocks old)
  --dry-run     build and check each transaction against the contract, print it, broadcast nothing
  --help        print this text

Exit codes: 0 done (including nothing to do), 1 bad card or network error, 2 usage.`;

export interface FinisherDeps {
  config: SampanConfig;
  readFile: (path: string) => string;
  /** Opens a chain client for these Electrum servers; closed when the run ends. */
  makeChain: (servers: string[]) => Chain & { close(): Promise<void> };
  fetchActive: FetchActive;
  log: (line: string) => void;
  err: (line: string) => void;
}

const FLAGS = new Set(['--convert', '--give-back', '--dry-run', '--help', '-h']);

export async function run(argv: string[], deps: FinisherDeps): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    deps.log(USAGE);
    return 0;
  }
  const files = argv.filter((a) => !a.startsWith('-'));
  const unknown = argv.filter((a) => a.startsWith('-') && !FLAGS.has(a));
  if (files.length !== 1 || unknown.length > 0 || (argv.includes('--convert') && argv.includes('--give-back'))) {
    deps.err(USAGE);
    return 2;
  }
  const { config } = deps;
  let raw: unknown;
  try {
    raw = JSON.parse(deps.readFile(files[0]!));
  } catch (e) {
    deps.err(`card rejected: cannot read ${files[0]}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  const read = readCard(raw, config.pay.maxNonce);
  if (typeof read === 'string') {
    deps.err(`card rejected: ${read}`);
    return 1;
  }
  const { card, params } = read;
  const dryRun = argv.includes('--dry-run');
  const mode: FinishMode = argv.includes('--give-back') ? 'giveBack' : argv.includes('--convert') ? 'convert' : 'auto';
  const chain = deps.makeChain(card.network === 'mainnet' ? config.electrum.servers : config.electrum.chipnetServers);
  const directory = new PoolDirectory({ indexers: config.cauldron.indexers, cacheSeconds: 0, fetchActive: deps.fetchActive, chain });
  try {
    deps.log(`landing ${card.address} -> ${card.ownerAddress} (${mode}${dryRun ? ', dry run' : ''})`);
    const results = await finishLanding(
      params,
      {
        chain,
        loadPools: async (category) => refreshPools(chain, await directory.active(category)),
        maxPools: config.cauldron.maxPoolsPerTx,
        satsPerByte: BigInt(config.fees.satsPerByte),
        tokenDustSats: BigInt(config.landing.tokenDustSats),
        attempts: 5,
        dryRun,
      },
      mode,
    );
    if (results.length === 0) deps.log('no coins at the landing address');
    for (const r of results) {
      if ('reason' in r) deps.log(`${r.coin}: ${r.action}: ${r.reason}`);
      else deps.log(`${r.coin}: ${r.action}, txid ${r.txid}, fee ${r.feeSats} sats${dryRun ? `\n${r.hex}` : ''}`);
    }
    return 0;
  } catch (e) {
    deps.err(e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    await chain.close();
  }
}
