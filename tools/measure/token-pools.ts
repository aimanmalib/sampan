// Depth and slippage of the Cauldron pools for one configured token, from the indexer with every pool lock
// checked against Electrum (the same PoolDirectory the server uses). Prints Markdown; no transaction.
//   npx tsx tools/measure/token-pools.ts <TOKEN> [sats=100000]
import { loadConfig } from '../../server/config.js';
import { ElectrumChain } from '../../server/chain/electrum.js';
import { httpFetchActive, PoolDirectory } from '../../server/indexer.js';
import { measureSlip, poolTotals } from './pool-depth.js';

async function main(): Promise<void> {
  const symbol = process.argv[2] ?? '';
  const sats = BigInt(process.argv[3] ?? 100_000);
  const config = loadConfig('config/sampan.json');
  const token = config.tokens[symbol];
  if (!token) throw new Error(`unknown token ${symbol}`);
  const category = token.category.toLowerCase();
  const chain = new ElectrumChain(config.electrum.servers);
  const fetchActive = httpFetchActive();
  const listed = (await fetchActive(config.cauldron.indexers[0]!, category)).length;
  const dir = new PoolDirectory({ indexers: config.cauldron.indexers, cacheSeconds: 60, fetchActive, chain });
  const pools = await dir.active(category);
  await chain.close();
  const totals = poolTotals(pools);
  const scale = 10 ** token.decimals;
  console.log(`${symbol} checked ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} against ${config.cauldron.indexers[0]} and Electrum.\n`);
  console.log(`Pools listed ${listed}, lock checked ${totals.pools}; ${Number(totals.sats) / 1e8} BCH and ${Number(totals.tokens) / scale} ${symbol} in them.\n`);
  if (totals.pools === 0) return;
  const rows = measureSlip(pools, category, { sats, maxPools: config.cauldron.maxPoolsPerTx, satsPerByte: BigInt(config.fees.satsPerByte) });
  console.log('| side | gives | gets | pools used | slip vs best pool price |\n|---|---|---|---|---|');
  for (const r of rows) {
    const [give, get] = r.side === 'buy' ? [`${r.supply} sats`, `${Number(r.demand) / scale} ${symbol}`] : [`${Number(r.supply) / scale} ${symbol}`, `${r.demand} sats`];
    console.log(`| ${r.side === 'buy' ? 'BCH to ' + symbol : symbol + ' to BCH'} | ${give} | ${get} | ${r.pools} | ${(r.slipBps / 100).toFixed(2)} % |`);
  }
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
