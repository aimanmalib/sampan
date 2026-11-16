// `npm run finisher -- <card.json>`: finishes a landing from its recovery card with no Sampan server.
// The logic lives in scripts/finisher-cli.ts; this wrapper only wires the real Electrum and indexer clients.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ElectrumChain } from '../server/chain/electrum.js';
import { loadConfig } from '../server/config.js';
import { httpFetchActive } from '../server/indexer.js';
import { run } from './finisher-cli.js';

const CONFIG = fileURLToPath(new URL('../config/sampan.json', import.meta.url));

run(process.argv.slice(2), {
  config: loadConfig(CONFIG),
  readFile: (path) => readFileSync(path, 'utf8'),
  makeChain: (servers) => new ElectrumChain(servers),
  fetchActive: httpFetchActive(),
  log: (line) => console.log(line),
  err: (line) => console.error(line),
}).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
