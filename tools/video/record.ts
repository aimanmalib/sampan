// Records the raw clips of the demo video (KP24): real pages, real mainnet transactions, a clock in the corner.
//   npx tsx tools/video/record.ts --scene front|how|swap|land|in|all [--engine chromium-desktop|webkit-iphone13|both]
//     [--base https://sampan.sasateguh.com] [--out state/video] [--write]
//     land: [--land-owner 9] [--land-bch 0.001]   in: --asset <thorchain.assets name> [--amount 1.6] [--receive PUSD] [--in-owner 19] [--port 4189]
// front, how, swap and land run on the live site; in runs the built server of this commit (dist/, npm run build) on
// this host with the one asset switched on (tools/video/scene-in.ts). swap, land and in spend from the test wallets
// inside state/budget.json. Clips go to <out>/<scene>-<engine>.webm and every take to <out>/shots.json (scene, clip,
// UTC start and end, marks, transaction ids shown). With --write each paid scene adds its row to the Runs table of
// docs/MEASURED.md, so every transaction id in shots.json is in MEASURED. A paid scene is ok only once its BCH
// transactions are known to --seen-min Electrum servers (tools/measure/seen.ts); a dropped broadcast is written as a
// failure and its shot is marked ok: false, so the edit leaves it out. Nothing here goes into the site.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hdKeysFromPhrase } from '../../core/client/session.js';
import { deriveAddress } from '../../core/wallet.js';
import { ElectrumChain } from '../../server/chain/electrum.js';
import { loadConfig } from '../../server/config.js';
import { SECRET_KEYS, parseEnv } from '../test-wallet/keys.js';
import { appendRuns } from '../measure/runs.js';
import { checkRun, electrumLookup, SEEN_DEFAULTS } from '../measure/seen.js';
import { arg, need, runCli } from '../measure/run-cli.js';
import { bringIn, EVM_BRIDGE } from './scene-in.js';
import { front, how, land, swap, type SceneValue } from './scene-live.js';
import { addShot, missingTxids, SCENES, type Scene, type ShotsFile } from './shots.js';
import { ENGINES, recordTake, type Engine, type Take } from './take.js';

/** Which engines record which scene by default: the phone only where the page itself is the point. */
const DEFAULT_ENGINES: Record<Scene, Engine[]> = {
  front: ['chromium-desktop', 'webkit-iphone13'],
  how: ['chromium-desktop', 'webkit-iphone13'],
  swap: ['chromium-desktop'],
  land: ['chromium-desktop'],
  in: ['chromium-desktop'],
};

async function main(): Promise<void> {
  const config = loadConfig('config/sampan.json');
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8')) as Record<string, string>;
  const base = (arg('--base') ?? 'https://sampan.sasateguh.com').replace(/\/$/, '');
  const out = arg('--out') ?? 'state/video';
  const write = process.argv.includes('--write');
  const sceneArg = arg('--scene') ?? 'all';
  const scenes: Scene[] = sceneArg === 'all' ? [...SCENES] : SCENES.includes(sceneArg as Scene) ? [sceneArg as Scene] : [];
  if (!scenes.length) throw new Error(`--scene is one of ${SCENES.join(', ')} or all`);
  const engineArg = arg('--engine');
  const enginesFor = (s: Scene): Engine[] =>
    engineArg === undefined ? DEFAULT_ENGINES[s] : engineArg === 'both' ? [...ENGINES] : ENGINES.includes(engineArg as Engine) ? [engineArg as Engine] : [];

  const env = parseEnv(readFileSync(path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env'), 'utf8'));
  const phrase = env.get(SECRET_KEYS.bchMainnet);
  if (!phrase) throw new Error(`${SECRET_KEYS.bchMainnet} is missing from the env file`);
  const keys = hdKeysFromPhrase(phrase);
  const receive = (i: number) => deriveAddress(keys.publicKey('receive', i), 'receive', i, 'bitcoincash');
  const live = { base, config, en, intentFile: path.join(out, 'intent.json') };
  const chain = new ElectrumChain(config.electrum.servers);
  const shotsPath = path.join(out, 'shots.json');
  const seen = electrumLookup();
  const seenOpts = {
    servers: config.electrum.servers,
    min: Number(arg('--seen-min') ?? SEEN_DEFAULTS.min),
    tries: Number(arg('--seen-tries') ?? SEEN_DEFAULTS.tries),
    waitMs: Number(arg('--seen-wait-ms') ?? SEEN_DEFAULTS.waitMs),
    lookup: seen.lookup,
  };
  let shots: ShotsFile = existsSync(shotsPath) ? (JSON.parse(readFileSync(shotsPath, 'utf8')) as ShotsFile) : { shots: [] };

  const play: Record<Scene, { run: (t: Take) => Promise<SceneValue>; init?: string[]; site: string }> = {
    front: { run: (t) => front(t, live), site: base },
    how: { run: (t) => how(t, live), site: base },
    swap: { run: (t) => swap(t, live), site: base },
    land: { run: (t) => land(t, { ...live, chain, owner: receive(Number(arg('--land-owner') ?? '9')), payBch: arg('--land-bch') ?? config.limits.judgeLandBch }), site: base },
    in: {
      run: (t) =>
        bringIn(t, {
          config,
          en,
          chain,
          asset: need('--asset'),
          amount: arg('--amount') ?? '1.6',
          receive: arg('--receive') ?? config.defaultToken,
          owner: receive(Number(arg('--in-owner') ?? '19')),
          port: Number(arg('--port') ?? '4189'),
        }),
      init: [EVM_BRIDGE],
      site: 'built server of this commit on the recording host, mainnet',
    },
  };

  try {
    for (const scene of scenes) {
      for (const engine of enginesFor(scene)) {
        const { run, init, site } = play[scene];
        const take = await recordTake(out, scene, engine, run, init);
        const { txids, receipt, run: said } = take.value;
        const row = said ? await checkRun(said, seenOpts) : undefined;
        if (row) {
          if (said?.ok && !row.ok) console.error(`${scene}/${engine}: the page said done but ${row.note}`);
          console.log(`Runs row: ${JSON.stringify({ ...row, utc: row.utc.toISOString() })}`);
          if (write) appendRuns('docs/MEASURED.md', [row]);
        }
        shots = addShot(shots, { scene, engine, clip: take.clip, startUtc: take.startUtc, endUtc: take.endUtc, txids, ...(receipt ? { receipt } : {}), ...(row ? { ok: row.ok } : {}), site, marks: take.marks });
        writeFileSync(shotsPath, `${JSON.stringify(shots, null, 2)}\n`);
      }
    }
    const missing = missingTxids(shots, readFileSync('docs/MEASURED.md', 'utf8'));
    if (missing.length) console.error(`transaction ids not in docs/MEASURED.md (run with --write): ${missing.join(', ')}`);
  } finally {
    await chain.close();
    await seen.close();
  }
}

runCli(main);
