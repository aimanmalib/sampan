// Puts the cut demo video on the site (ADR 0082, K5P4): copies the file of tools/video/edit.sh into web/public/demo/
// (it is already H.264 + AAC with faststart and under the 25 MB limit; a larger one is refused, not re-encoded here),
// takes a poster frame, writes docs/demo/chapters.json from the edit plan, state/video/shots.json and the ok rows of
// docs/MEASURED.md, and writes one WebVTT track per page language (English from the edit, the rest from lang/).
//   npx tsx tools/video/demo-files.ts [--video state/video/edit-out/sampan-demo.mp4] [--work state/video/edit]
//     [--clips state/video] [--poster-at 4]
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../server/config.js';
import { assetOfAmount, buildChapters, checkChapters, type ChapterRun, type DemoFile } from '../../core/demo.js';
import { parseRuns } from '../../core/proof.js';
import { arg, runCli } from '../measure/run-cli.js';
import { translatedTrack, trackName } from './demo-subs.js';
import type { Captions, Placed } from './plan.js';
import type { ShotsFile } from './shots.js';

export const MAX_BYTES = 25 * 1024 * 1024;
const readJson = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr ?? '').split('\n').slice(-8).join('\n')}`);
  return r.stdout ?? '';
}

/** The video must be H.264 + AAC with its index at the front (it starts playing before it is all loaded). */
function checkVideo(file: string): void {
  const bytes = statSync(file).size;
  if (bytes > MAX_BYTES) throw new Error(`${file} is ${bytes} bytes, over 25 MB: encode it again smaller first`);
  const codecs = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file]).trim().split('\n');
  if (!codecs.includes('h264') || !codecs.includes('aac')) throw new Error(`${file} is ${codecs.join('+')}, not h264+aac`);
  const head = readFileSync(file).subarray(0, 64 * 1024).toString('latin1');
  if (!head.includes('moov')) throw new Error(`${file} has no index at the front (ffmpeg -movflags +faststart)`);
}

async function main(): Promise<void> {
  const config = loadConfig('config/sampan.json');
  const video = arg('--video') ?? 'state/video/edit-out/sampan-demo.mp4';
  const work = arg('--work') ?? 'state/video/edit';
  const clips = arg('--clips') ?? 'state/video';
  const posterAt = arg('--poster-at') ?? '4';
  const publicDir = path.join('web/public', path.dirname(config.demo.video));
  mkdirSync(publicDir, { recursive: true });
  mkdirSync('docs/demo', { recursive: true });

  checkVideo(video);
  const plan = readJson<{ total: number; placed: Placed[] }>(path.join(work, 'plan.json'));
  const shots = readJson<ShotsFile>(path.join(clips, 'shots.json')).shots;
  const measured = parseRuns(readFileSync('docs/MEASURED.md', 'utf8'));
  const runs: ChapterRun[] = measured.map((r) => ({ ok: r.ok, ids: r.txids.map((t) => t.id) }));
  const round = (n: number): number => Math.round(n * 1000) / 1000;
  const scenes = plan.placed.map((p) => ({ id: p.id, start: round(p.start), duration: round(p.duration), voiceAt: round(p.voiceAt), voiceSeconds: round(p.voiceSeconds) }));
  const placed = plan.placed.map((p, i) => ({ ...scenes[i]!, files: p.windows.map((w) => w.file) }));
  const chapters = buildChapters(placed, shots, runs, config.site.url);
  // {asset}: the stablecoin of the ok Bring in run the "in" chapter shows.
  const inId = chapters.find((c) => c.id === 'in')?.txids[0];
  const asset = assetOfAmount(measured.find((r) => r.ok && r.flow === 'in' && r.txids.some((t) => t.id === inId))?.amount ?? '');
  if (!asset) throw new Error('no ok Bring in run for the "in" chapter, so {asset} cannot be filled');
  const file: DemoFile = { seconds: round(plan.total), vars: { asset }, scenes, chapters };
  const problems = checkChapters(file, runs);
  if (problems.length) throw new Error(`chapters:\n${problems.join('\n')}`);

  const videoOut = path.join('web/public', config.demo.video);
  copyFileSync(video, videoOut);
  run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-ss', posterAt, '-i', video, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '5', path.join('web/public', config.demo.poster)]);
  writeFileSync('docs/demo/chapters.json', `${JSON.stringify(file, null, 2)}\n`);
  const maxChars = readJson<Captions>('tools/video/captions.json').subtitle.maxChars;
  for (const { code } of config.i18n.languages) {
    const track = code === 'en' ? readFileSync(path.join(work, 'sampan-demo.en.vtt'), 'utf8') : translatedTrack(file, readJson(`lang/${code}.json`), maxChars);
    writeFileSync(path.join('web/public', trackName(config.demo.video, code)), track);
  }
  console.log(`${file.chapters.length} chapters (${file.chapters.map((c) => c.id).join(', ')}), ${statSync(videoOut).size} bytes`);
}

runCli(main);
