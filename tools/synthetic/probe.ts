// Synthetic monitor entry point, run by deploy/synthetic.sh from the host's cron.
//   tsx tools/synthetic/probe.ts                    every hourly probe against the public site
//   tsx tools/synthetic/probe.ts --only page,quote  some of them
//   tsx tools/synthetic/probe.ts --record render=fail --detail "..."   record a result measured outside (render)
// Prints one JSON line per probe ({probe, ok, ms, detail}) and one `ALERT<TAB>level<TAB>text` line per alert to send;
// the shell sends them. State (deploy/.synthetic-state, not tracked) keeps failures in a row, alerts sent today and
// the latest runs.
// Environment: SYNTHETIC_URL (default site.url), SYNTHETIC_STATE, SYNTHETIC_NOW (epoch seconds), SYNTHETIC_LANG
// (default ms: alerts go to the owner), SYNTHETIC_TIMEOUT_MS, SAMPAN_CONFIG_PATCH.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ElectrumChain } from '../../server/chain/electrum.js';
import { loadConfig } from '../../server/config.js';
import { httpFetchActive } from '../../server/indexer.js';
import { Thornode } from '../../server/routes/thornode.js';
import { readState, step, type ProbeResult } from './alerts.js';
import { runProbes, type ProbeDeps } from './probes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const config = loadConfig(path.join(ROOT, 'config/sampan.json'), process.env.SAMPAN_CONFIG_PATCH);
const url = process.env.SYNTHETIC_URL || config.site.url;
const stateFile = process.env.SYNTHETIC_STATE || path.join(ROOT, 'deploy/.synthetic-state');
const now = process.env.SYNTHETIC_NOW ? new Date(Number(process.env.SYNTHETIC_NOW) * 1000) : new Date();
const timeoutMs = Number(process.env.SYNTHETIC_TIMEOUT_MS || 20_000);
const lang = JSON.parse(readFileSync(path.join(ROOT, `lang/${process.env.SYNTHETIC_LANG || 'ms'}.json`), 'utf8')) as Record<string, string>;

const deps: ProbeDeps = {
  fetch,
  timeoutMs,
  tipHeight: async (server) => {
    const chain = new ElectrumChain([server], { timeoutMs });
    try {
      return await chain.tipHeight();
    } finally {
      await chain.close().catch(() => undefined);
    }
  },
  activePools: async (indexer, category) => (await httpFetchActive(timeoutMs)(indexer, category)).length,
  inbound: (node) => new Thornode([node], undefined, timeoutMs).request('/thorchain/inbound_addresses'),
};

async function main(): Promise<void> {
  let results: ProbeResult[];
  const record = arg('--record');
  if (record) {
    const [probe, outcome] = record.split('=');
    if (!probe || (outcome !== 'ok' && outcome !== 'fail')) throw new Error('--record <probe>=ok|fail');
    results = [{ probe, ok: outcome === 'ok', ms: 0, detail: arg('--detail') ?? '' }];
  } else {
    results = await runProbes({ url, config, deps }, arg('--only')?.split(','));
  }
  const prev = readState(existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : undefined);
  const { state, alerts } = step(prev, results, now, (k) => lang[k]);
  writeFileSync(`${stateFile}.tmp`, `${JSON.stringify(state, null, 1)}\n`);
  renameSync(`${stateFile}.tmp`, stateFile);
  for (const r of results) console.log(JSON.stringify(r));
  for (const a of alerts) console.log(`ALERT\t${a.level}\t${a.text.replace(/\s+/g, ' ')} (${url})`);
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(`synthetic: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
