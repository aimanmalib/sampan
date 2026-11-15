// Finishes a landing from its recovery card, with no Sampan server: converts the BCH at the landing address to
// tokens for the owner when the Cauldron pools meet the contract minimum, otherwise returns the BCH to the owner
// once the coin is old enough. Talks only to public Electrum servers and the public Cauldron indexer.
// Usage: npx tsx scripts/finisher.ts <card.json> [--convert | --give-back] [--dry-run]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCard } from '../core/landing-card.js';
import { ElectrumChain } from '../server/chain/electrum.js';
import { loadConfig } from '../server/config.js';
import { httpFetchActive, PoolDirectory } from '../server/indexer.js';
import { finishLanding, type FinishMode } from '../server/landing/finish.js';
import { refreshPools } from '../server/pools.js';

const CONFIG = fileURLToPath(new URL('../config/sampan.json', import.meta.url));

async function main(argv: string[]): Promise<number> {
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: npx tsx scripts/finisher.ts <card.json> [--convert | --give-back] [--dry-run]');
    return 2;
  }
  const read = readCard(JSON.parse(readFileSync(file, 'utf8')));
  if (typeof read === 'string') {
    console.error(`card rejected: ${read}`);
    return 1;
  }
  const { card, params } = read;
  const mode: FinishMode = argv.includes('--give-back') ? 'giveBack' : argv.includes('--convert') ? 'convert' : 'auto';
  const config = loadConfig(CONFIG);
  const servers = card.network === 'mainnet' ? config.electrum.servers : config.electrum.chipnetServers;
  const chain = new ElectrumChain(servers);
  const directory = new PoolDirectory({ indexers: config.cauldron.indexers, cacheSeconds: 0, fetchActive: httpFetchActive(), chain });
  try {
    console.log(`landing ${card.address} -> ${card.ownerAddress} (${mode}${argv.includes('--dry-run') ? ', dry run' : ''})`);
    const results = await finishLanding(
      params,
      {
        chain,
        loadPools: async (category) => refreshPools(chain, await directory.active(category)),
        maxPools: config.cauldron.maxPoolsPerTx,
        satsPerByte: BigInt(config.fees.satsPerByte),
        tokenDustSats: BigInt(config.landing.tokenDustSats),
        attempts: 5,
        dryRun: argv.includes('--dry-run'),
      },
      mode,
    );
    if (results.length === 0) console.log('no coins at the landing address');
    for (const r of results) {
      if ('reason' in r) console.log(`${r.coin}: ${r.action}: ${r.reason}`);
      else console.log(`${r.coin}: ${r.action}, txid ${r.txid}, fee ${r.feeSats} sats${r.txid === '(dry run)' ? `\n${r.hex}` : ''}`);
    }
    return 0;
  } finally {
    await chain.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
