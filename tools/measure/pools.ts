// G1 evidence: for the first pools the indexer lists, the locking bytecode rebuilt from owner_pkh (pool v0
// template) holds exactly the outpoint the indexer names, read from Electrum. Prints a Markdown table.
//   npx tsx tools/measure/pools.ts [count=3]
import { loadConfig } from '../../server/config.js';
import { poolV0LockingHex } from '../../core/pools/template.js';
import { ElectrumChain } from '../../server/chain/electrum.js';
import { httpFetchActive } from '../../server/indexer.js';

async function main(): Promise<void> {
  const count = Number(process.argv[2] ?? 3);
  const config = loadConfig('config/sampan.json');
  const token = config.tokens[config.defaultToken]!;
  const chain = new ElectrumChain(config.electrum.servers);
  const active = await httpFetchActive()(config.cauldron.indexers[0]!, token.category);
  const picked = [...active].sort((a, b) => Number(b.sats) - Number(a.sats)).slice(0, count);
  const rows: string[] = [];
  let bad = 0;
  for (const p of picked) {
    const lock = poolV0LockingHex(p.owner_pkh.toLowerCase());
    const utxos = await chain.listUnspent(lock);
    const hit = utxos.find((u) => u.txid === p.txid && u.vout === p.tx_pos);
    const ok = !!hit && hit.token?.category === token.category && hit.sats === BigInt(p.sats) && hit.token.amount === BigInt(p.tokens);
    if (!ok) bad += 1;
    rows.push(`| ${p.owner_pkh.toLowerCase()} | ${p.txid}:${p.tx_pos} | ${p.sats} | ${p.tokens} | ${ok ? 'match' : 'no match'} |`);
  }
  await chain.close();
  console.log(`Checked ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} against ${config.cauldron.indexers[0]} and Electrum.\n`);
  console.log('| owner_pkh | pool outpoint | sats | token units | rebuilt lock holds it |\n|---|---|---|---|---|');
  console.log(rows.join('\n'));
  process.exit(bad === 0 && rows.length === count ? 0 : 1);
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
