// Cuts the demo video from the raw clips of tools/video/record.ts (KP24, K5P3): scenes and words from
// tools/video/captions.json, numbers from docs/MEASURED.md, narration from ElevenLabs (declared on the end card and in
// the README), a quiet original pad made here as music, loudness normalised, English subtitles burned in and written
// beside the file as SRT and WebVTT. Then measures the result (length, audio length, loudness, silence, frames).
//   tools/video/edit.sh --out <file.mp4> [--clips state/video] [--work state/video/edit] [--key-file <env file>] [--no-voice]
// The ElevenLabs key comes from ELEVENLABS_API_KEY or the ELEVENLABS_API_KEY line of --key-file; it is sent only as a
// request header and never written. Narration is cached by text, so a second run makes no request.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import path from 'node:path';
import { headlineParts } from '../../core/client/measured.js';
import { measuredHeadline } from '../../scripts/measured-json.js';
import { arg, runCli } from '../measure/run-cli.js';
import { ass, chunks, pageX, clipWindow, cueTimes, fill, placeScenes, runVars, srt, vtt, type Alignment, type Captions, type Cue, type Placed } from './plan.js';
import type { ShotsFile } from './shots.js';

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr ?? '').split('\n').slice(-12).join('\n')}`);
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}
const ffmpeg = (args: string[]): string => run('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args]);
const seconds = (file: string, stream?: string): number =>
  Number(run('ffprobe', ['-v', 'error', ...(stream ? ['-select_streams', stream, '-show_entries', 'stream=duration'] : ['-show_entries', 'format=duration']), '-of', 'csv=p=0', file]).trim().split('\n')[0]);

function apiKey(): string | undefined {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const f = arg('--key-file');
  if (!f) return undefined;
  return readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('ELEVENLABS_API_KEY='))?.slice('ELEVENLABS_API_KEY='.length).trim();
}

/** POST over IPv4 (the host's IPv6 route to the API is unreliable); resolves with the JSON body. */
function postJson(url: string, key: string, body: unknown): Promise<{ audio_base64: string; alignment: Alignment }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', family: 4, headers: { 'xi-api-key': key, 'content-type': 'application/json' }, timeout: 180_000 }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (b: Buffer) => parts.push(b));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(`ElevenLabs ${res.statusCode}: ${text.slice(0, 200)}`));
        resolve(JSON.parse(text) as { audio_base64: string; alignment: Alignment });
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

async function narrate(c: Captions, dir: string, id: string, said: string): Promise<{ file: string; align: Alignment }> {
  const hash = createHash('sha256').update(JSON.stringify([c.voice, said])).digest('hex').slice(0, 12);
  const file = path.join(dir, `${id}-${hash}.mp3`);
  const alignFile = file.replace(/\.mp3$/, '.json');
  if (!existsSync(file)) {
    const key = apiKey();
    if (!key) throw new Error('narration needs ELEVENLABS_API_KEY or --key-file (or pass --no-voice)');
    const body = await postJson(`https://api.elevenlabs.io/v1/text-to-speech/${c.voice.voiceId}/with-timestamps?output_format=mp3_44100_192`, key, { text: said, model_id: c.voice.model });
    writeFileSync(file, Buffer.from(body.audio_base64, 'base64'));
    writeFileSync(alignFile, JSON.stringify(body.alignment));
  }
  return { file, align: JSON.parse(readFileSync(alignFile, 'utf8')) as Alignment };
}

function renderScene(c: Captions, clips: string, p: Placed, layout: string, out: string): void {
  const { width: W, height: H, fps } = c.frame;
  const bg = `color=c=0x${c.style.paper.slice(1)}:s=${W}x${H}:r=${fps}:d=${p.duration}`;
  const inputs = p.windows.flatMap((w) => ['-ss', String(w.start), '-to', String(w.end), '-i', path.join(clips, w.file)]);
  const norm = (i: number, h: number) => `[${i}:v]fps=${fps},scale=-2:${h}:flags=lanczos,setsar=1,settb=AVTB,setpts=PTS-STARTPTS`;
  let graph: string;
  if (layout === 'card') graph = `${bg},format=yuv420p[v]`;
  else if (layout === 'pair') {
    const h = H - c.frame.pageTop - 10;
    const legs = p.windows.map((_, i) => `${norm(i, h)},tpad=stop_mode=clone:stop_duration=${p.duration}[p${i}]`);
    const xs = p.windows.length === 2 ? [Math.round(W * 0.27), Math.round(W * 0.73)] : [W / 2];
    let chain = `[${p.windows.length}:v]null[b0]`;
    p.windows.forEach((_, i) => { chain += `;[b${i}][p${i}]overlay=x=${xs[i]}-w/2:y=${c.frame.pageTop}:shortest=0[b${i + 1}]`; });
    graph = `${legs.join(';')};${chain};[b${p.windows.length}]trim=duration=${p.duration},format=yuv420p[v]`;
    inputs.push('-f', 'lavfi', '-i', bg);
  } else {
    const pw = Math.round((W * c.frame.pageScale) / 2) * 2;
    const ph = Math.round((H * c.frame.pageScale) / 2) * 2;
    const legs = p.windows.map((_, i) => `${norm(i, ph)},scale=${pw}:${ph}:flags=lanczos,setsar=1[s${i}]`);
    const used = p.windows.reduce((n, w) => n + (w.end - w.start), 0);
    graph = `${legs.join(';')};${p.windows.map((_, i) => `[s${i}]`).join('')}concat=n=${p.windows.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=${Math.max(0, p.duration - used + 0.5)},trim=duration=${p.duration},pad=${W}:${H}:${pageX(c)}:${c.frame.pageTop}:color=0x${c.style.paper.slice(1)},format=yuv420p[v]`;
  }
  ffmpeg([...(layout === 'card' ? ['-f', 'lavfi', '-i', bg] : inputs), '-filter_complex', graph, '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-r', String(fps), '-an', out]);
}

/** A soft sustained chord that swells slowly: original music, nothing licensed. */
function music(c: Captions, total: number, out: string): void {
  const a = c.audio;
  const tones = a.musicChord.map((f, i) => `sin(2*PI*${f}*t)*(0.6+0.4*sin(2*PI*t/${a.musicSwellSeconds}+${i}))`).join('+');
  ffmpeg(['-f', 'lavfi', '-i', `aevalsrc='(${tones})/${a.musicChord.length}':s=44100:d=${total}`, '-af', `lowpass=f=1800,afade=t=in:d=2,afade=t=out:st=${Math.max(0, total - 3)}:d=3,volume=${a.musicDb}dB`, '-ac', '2', out]);
}

function measure(file: string, total: number): Record<string, unknown> {
  const r128 = ffmpeg(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const integrated = Number(/I:\s+(-?[\d.]+) LUFS\s+Threshold[\s\S]*$/.exec(r128.slice(r128.lastIndexOf('Summary:')))?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(r128.slice(r128.lastIndexOf('True peak:')))?.[1]);
  const quiet = ffmpeg(['-t', '15', '-i', file, '-af', 'silencedetect=noise=-50dB:d=2', '-f', 'null', '-']);
  return {
    seconds: seconds(file), videoSeconds: seconds(file, 'v:0'), audioSeconds: seconds(file, 'a:0'), planned: total,
    lufs: integrated, truePeakDb: peak, silencesOver2sInFirst15s: (quiet.match(/silence_start/g) ?? []).length,
    bytes: readFileSync(file).length,
  };
}

async function main(): Promise<void> {
  const out = arg('--out');
  if (!out) throw new Error('--out <file.mp4> is needed');
  const clips = arg('--clips') ?? 'state/video';
  const work = arg('--work') ?? path.join(clips, 'edit');
  const voiceOn = !process.argv.includes('--no-voice');
  mkdirSync(path.join(work, 'voice'), { recursive: true });
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const c = JSON.parse(readFileSync('tools/video/captions.json', 'utf8')) as Captions;
  const shots = (JSON.parse(readFileSync(path.join(clips, 'shots.json'), 'utf8')) as ShotsFile).shots;
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8')) as Record<string, string>;
  const list = (items: string[]): string => new Intl.ListFormat('en', { type: 'conjunction' }).format(items);
  const headline = headlineParts(measuredHeadline(), (k, v) => fill(en[k] ?? '', v ?? {}), list).join(' · ');
  const vars = { headline, ...runVars(shots, readFileSync('docs/MEASURED.md', 'utf8')) };
  const captions = c.scenes.map((s) => fill(s.caption, vars));
  const texts = c.scenes.map((s) => fill(s.text, vars));

  const voices: Array<{ file: string; align: Alignment } | undefined> = [];
  for (const s of c.scenes) voices.push(voiceOn ? await narrate(c, path.join(work, 'voice'), s.id, fill(s.say ?? s.text, vars)) : undefined);
  const lengths = voices.map((v, i) => (v ? seconds(v.file) : texts[i]!.length / 15));
  const windows = c.scenes.map((s) => (s.clips ?? []).map((k) => clipWindow(shots, k)));
  const placed = placeScenes(c.scenes, windows, lengths, c.audio);
  const total = placed.reduce((n, p) => n + p.duration, 0);

  const cues: Cue[] = placed.flatMap((p, i) => cueTimes(chunks(texts[i]!, c.subtitle.maxChars), p.voiceAt, p.voiceSeconds, voices[i]?.align, !c.scenes[i]!.say));
  const end = placed.at(-1)!;
  const card = c.scenes.at(-1)?.card ? { start: end.start, end: end.start + end.duration, lines: c.scenes.at(-1)!.card! } : undefined;
  writeFileSync(path.join(work, 'subs.ass'), ass(c, placed, cues, captions, card));
  writeFileSync(out.replace(/\.mp4$/, '.srt'), srt(cues));
  writeFileSync(path.join(work, 'sampan-demo.en.vtt'), vtt(cues));
  writeFileSync(path.join(work, 'plan.json'), `${JSON.stringify({ total, captions, placed }, null, 2)}\n`);

  const parts = placed.map((p, i) => {
    const f = path.join(work, `scene-${i}-${p.id}.mp4`);
    renderScene(c, clips, p, c.scenes[i]!.layout ?? 'full', f);
    console.log(`scene ${p.id}: ${p.duration.toFixed(1)} s at ${p.start.toFixed(1)} s`);
    return f;
  });
  writeFileSync(path.join(work, 'parts.txt'), parts.map((f) => `file '${path.resolve(f)}'`).join('\n'));
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'parts.txt'), '-c', 'copy', path.join(work, 'video.mp4')]);

  music(c, total, path.join(work, 'music.wav'));
  const voiced = voices.flatMap((v, i) => (v ? [{ file: v.file, at: placed[i]!.voiceAt }] : []));
  const mixIn = [...voiced.flatMap((v) => ['-i', v.file]), '-i', path.join(work, 'music.wav')];
  const delays = voiced.map((v, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${Math.round(v.at * 1000)}:all=1[d${i}]`);
  const mixGraph = `${delays.join(';')}${delays.length ? ';' : ''}${voiced.map((_, i) => `[d${i}]`).join('')}[${voiced.length}:a]amix=inputs=${voiced.length + 1}:normalize=0:duration=longest,apad,atrim=duration=${total}[m]`;
  ffmpeg([...mixIn, '-filter_complex', mixGraph, '-map', '[m]', path.join(work, 'mix.wav')]);
  const a = c.audio;
  const ln = `loudnorm=I=${a.lufs}:TP=${a.truePeak}:LRA=${a.lra}`;
  const first = ffmpeg(['-i', path.join(work, 'mix.wav'), '-af', `${ln}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(first.slice(first.lastIndexOf('{'), first.lastIndexOf('}') + 1)) as Record<string, string>;
  const second = `${ln}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  ffmpeg([
    '-i', path.join(work, 'video.mp4'), '-i', path.join(work, 'mix.wav'),
    '-vf', `ass=${path.join(work, 'subs.ass')}:fontsdir=${c.style.fontsDir}`, '-af', `${second},aresample=48000,atrim=duration=${total}`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(c.frame.fps),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', '-t', String(total), out,
  ]);
  for (const t of [5, 30, 60]) {
    ffmpeg(['-ss', String(t), '-i', out, '-frames:v', '1', path.join(work, `frame-${t}s.png`)]);
    ffmpeg(['-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'scale=390:-2', path.join(work, `frame-${t}s-390.png`)]);
  }
  const report = { ...measure(out, total), voice: voiceOn ? `${c.voice.provider} ${c.voice.voiceName} (${c.voice.model})` : 'none', scenes: placed.map((p) => ({ id: p.id, start: p.start, duration: p.duration })) };
  writeFileSync(path.join(work, 'measure.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}

runCli(main);
