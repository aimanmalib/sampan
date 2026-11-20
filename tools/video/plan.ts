// The pure half of the demo video edit (tools/video/edit.ts runs ffmpeg): fills caption numbers from docs/MEASURED.md,
// turns clip windows (a mark of state/video/shots.json plus an offset) into seconds, lays the scenes on one timeline
// from the narration lengths, and writes the subtitles (ASS burned in, SRT and WebVTT beside the file).
// Tested in tests/video-plan.test.ts.
import { parseRuns } from '../../scripts/crossings-table.js';
import type { Shot } from './shots.js';

export type MarkRef = [what: string, offsetSeconds: number];
export interface Clip {
  shot: string;
  from: MarkRef;
  to: MarkRef;
  /** For a shot marked ok: false: the mark from which the dropped transaction is on screen; the window must end before it. */
  endsBefore?: string;
}
export interface SceneSpec {
  id: string;
  layout?: 'full' | 'pair' | 'card';
  clips?: Clip[];
  seconds?: number;
  card?: string[];
  caption: string;
  text: string;
  say?: string;
}
export interface Captions {
  frame: { width: number; height: number; fps: number; pageTop: number; pageScale: number };
  voice: { provider: string; voiceId: string; voiceName: string; model: string; language: string };
  style: Record<'paper' | 'ink' | 'river' | 'lamp' | 'card' | 'display' | 'text' | 'mono' | 'fontsDir', string>;
  audio: { lufs: number; truePeak: number; lra: number; musicDb: number; musicChord: number[]; musicSwellSeconds: number; leadSeconds: number; tailSeconds: number };
  subtitle: { maxChars: number; size: number; captionSize: number };
  scenes: SceneSpec[];
}
export interface Window { file: string; start: number; end: number }
export interface Alignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
export interface Placed { id: string; start: number; duration: number; voiceAt: number; voiceSeconds: number; windows: Window[] }
export interface Cue { start: number; end: number; text: string }

/** `{name}` placeholders; an unknown name is an error, so no caption ships with a hole or a typed number. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([\w.]+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) throw new Error(`caption placeholder {${k}} has no value`);
    return v;
  });
}

/** `{<scene>.seconds}` for every shot with a transaction: the seconds of the ok Runs row holding its first txid. */
export function runVars(shots: Shot[], measured: string): Record<string, string> {
  const runs = parseRuns(measured);
  const vars: Record<string, string> = {};
  for (const s of shots) {
    const tx = s.txids[0];
    if (!tx || s.ok === false) continue;
    const row = runs.find((r) => r.txid.includes(tx) && r.result.toLowerCase() === 'ok' && /^\d+(\.\d+)?$/.test(r.seconds));
    if (row) vars[`${s.scene}.seconds`] = row.seconds;
  }
  return vars;
}

/** English UI strings as caption placeholders: {en.hero.title} is the hero title of lang/en.json, never retyped. */
export function langVars(en: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(en).map(([k, v]) => [`en.${k}`, v]));
}

/** The transactions of every shot a cut shows, and those of them docs/MEASURED.md does not hold (must be none). */
export function sceneTxids(shots: Shot[], scenes: SceneSpec[], measured: string): { txids: string[]; missing: string[] } {
  const used = new Set(scenes.flatMap((s) => (s.clips ?? []).map((c) => c.shot)));
  const txids = [...new Set(shots.filter((s) => used.has(`${s.scene}/${s.engine}`)).flatMap((s) => s.txids))];
  return { txids, missing: txids.filter((t) => !measured.includes(t)) };
}

/** A clip window in seconds of its clip file. Shots marked ok: false (a dropped broadcast on screen) are refused. */
export function clipWindow(shots: Shot[], clip: Clip): Window {
  const [scene, engine] = clip.shot.split('/');
  const shot = shots.find((s) => s.scene === scene && s.engine === engine);
  if (!shot) throw new Error(`no shot ${clip.shot} in shots.json`);
  const at = ([what, off]: MarkRef): number => {
    const m = shot.marks.find((k) => k.what === what);
    if (!m) throw new Error(`shot ${clip.shot} has no mark "${what}"`);
    return Math.max(0, m.at / 1000 + off);
  };
  const start = at(clip.from);
  const end = at(clip.to);
  if (end <= start) throw new Error(`clip ${clip.shot}: window ends before it starts`);
  if (shot.ok === false) {
    // The shot shows a transaction the network dropped from some mark on; only the part before it may be used.
    if (!clip.endsBefore) throw new Error(`shot ${clip.shot} shows a transaction the network dropped; name the mark it appears at (endsBefore) or record it again`);
    if (end > at([clip.endsBefore, 0])) throw new Error(`clip ${clip.shot}: window runs past "${clip.endsBefore}", where the dropped transaction is on screen`);
  }
  return { file: shot.clip, start: round(start), end: round(end) };
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
const length = (w: Window): number => w.end - w.start;

/** Scene length: the clips as recorded (side by side for a pair, so the longer one), never shorter than the voice. */
export function placeScenes(scenes: SceneSpec[], windows: Window[][], voice: number[], a: Captions['audio']): Placed[] {
  let t = 0;
  return scenes.map((s, i) => {
    const w = windows[i] ?? [];
    const clips = s.layout === 'pair' ? Math.max(0, ...w.map(length)) : w.reduce((n, x) => n + length(x), 0);
    const need = a.leadSeconds + (voice[i] ?? 0) + a.tailSeconds;
    const duration = round(Math.max(clips, need, s.seconds ?? 0));
    const placed = { id: s.id, start: round(t), duration, voiceAt: round(t + a.leadSeconds), voiceSeconds: voice[i] ?? 0, windows: w };
    t += duration;
    return placed;
  });
}

/** Splits a line into subtitle chunks of at most `max` characters, at sentence ends first (a stop followed by a space or the end, so a web address stays whole), then at word gaps. */
export function chunks(text: string, max: number): string[] {
  const out: string[] = [];
  for (const sentence of text.match(/\S.*?(?:[.!?]+(?=\s|$)|$)/g) ?? []) {
    let cur = '';
    for (const word of sentence.trim().split(/\s+/)) {
      if (cur && (cur + ' ' + word).length > max) {
        out.push(cur);
        cur = word;
      } else cur = cur ? `${cur} ${word}` : word;
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Times each chunk by where its characters fall in the spoken text (alignment), or by share of length. */
export function cueTimes(parts: string[], voiceAt: number, seconds: number, align?: Alignment, sameText = true): Cue[] {
  const total = parts.reduce((n, p) => n + p.length + 1, 0);
  let pos = 0;
  return parts.map((text) => {
    const from = pos;
    pos += text.length + 1;
    const at = (c: number): number => {
      if (align && sameText && align.characters.length) {
        const i = Math.min(align.characters.length - 1, Math.max(0, c));
        return align.character_start_times_seconds[i] ?? 0;
      }
      return (c / total) * seconds;
    };
    const end = pos >= total ? seconds : at(pos - 1);
    return { start: round(voiceAt + at(from)), end: round(voiceAt + end), text };
  });
}

const clock = (s: number, sep: string, frac: number): string => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const rest = String(ms % 1000).padStart(3, '0').slice(0, frac);
  const hh = sep === '.' && frac === 2 ? String(h) : String(h).padStart(2, '0');
  return `${hh}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${sep}${rest}`;
};

export function srt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${clock(c.start, ',', 3)} --> ${clock(c.end, ',', 3)}\n${c.text}\n`).join('\n');
}

export function vtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${clock(c.start, '.', 3)} --> ${clock(c.end, '.', 3)}\n${c.text}\n`).join('\n')}`;
}

/** #rrggbb -> ASS &HAABBGGRR. */
export function assColour(hex: string, alpha = 0): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const a = alpha.toString(16).padStart(2, '0');
  return `&H${a}${m[3]}${m[2]}${m[1]}`.toUpperCase();
}

const assText = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, '\\N');

/** Left edge of the page clip, which sits below the caption band, scaled and centred. */
export function pageX(c: Captions): number {
  return Math.round((c.frame.width - c.frame.width * c.frame.pageScale) / 2);
}

/** One ASS file: subtitles at the bottom, the scene caption at the top left, the end card centred. */
export function ass(c: Captions, placed: Placed[], subs: Cue[], captions: string[], card?: { start: number; end: number; lines: string[] }): string {
  const { width, height } = c.frame;
  const st = c.style;
  const fmt = 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding';
  const style = (name: string, font: string, size: number, fg: string, box: string, align: number, mv: number, border = 3, outline = 14): string =>
    `Style: ${name},${font},${size},${fg},${fg},${box},${box},0,0,0,0,100,100,0,0,${border},${outline},0,${align},96,96,${mv},1`;
  const ev = (s: number, e: number, name: string, text: string): string => `Dialogue: 0,${clock(s, '.', 2)},${clock(e, '.', 2)},${name},,0,0,0,,${text}`;
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]', fmt,
    style('Sub', st.text, c.subtitle.size, assColour(st.card), assColour(st.ink, 0x30), 2, 48),
    style('Cap', st.text, c.subtitle.captionSize, assColour(st.ink), assColour(st.paper), 7, 28, 1, 0),
    style('Card', st.display, 96, assColour(st.ink), assColour(st.paper), 5, 0, 1, 0),
    style('CardSmall', st.text, 40, assColour(st.river), assColour(st.paper), 5, 0, 1, 0),
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  placed.forEach((p, i) => {
    const cap = captions[i];
    if (cap) lines.push(ev(p.start + 0.2, p.start + p.duration - 0.1, 'Cap', `{\\pos(${pageX(c)},28)\\an7}${assText(cap)}`));
  });
  for (const s of subs) lines.push(ev(s.start, s.end, 'Sub', assText(s.text)));
  if (card) {
    const [first, ...rest] = card.lines;
    lines.push(ev(card.start, card.end, 'Card', `{\\pos(${width / 2},${Math.round(height * 0.42)})}${assText(first ?? '')}`));
    rest.forEach((l, i) => lines.push(ev(card.start, card.end, 'CardSmall', `{\\pos(${width / 2},${Math.round(height * 0.56) + i * 60})}${assText(l)}`)));
  }
  return `${lines.join('\n')}\n`;
}
