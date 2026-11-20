import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ass, assColour, chunks, clipWindow, cueTimes, fill, placeScenes, runVars, srt, vtt, type Captions } from '../tools/video/plan.js';
import type { Shot } from '../tools/video/shots.js';

const TX = 'a'.repeat(64);
const DROPPED = 'b'.repeat(64);
const shot = (o: Partial<Shot>): Shot => ({ scene: 'land', engine: 'chromium-desktop', clip: 'land.webm', startUtc: '', endUtc: '', txids: [], site: 'https://example.test', marks: [], ...o });
const MEASURED = [
  '## Runs',
  '',
  '| UTC | flow | amount | txid | seconds | result |',
  '|---|---|---|---|---|---|',
  `| 2026-11-20T11:40:46Z | land | 0.001 BCH to 0.19 PUSD | ${TX} | 4.3 | ok |`,
  `| 2026-11-20T11:41:20Z | swap | 0.001 BCH | ${DROPPED} | 2.1 | fail (broadcast dropped) |`,
].join('\n');
const captions = JSON.parse(readFileSync('tools/video/captions.json', 'utf8')) as Captions;

describe('demo video plan', () => {
  it('fills placeholders and refuses an unknown one, so no caption ships a typed or missing number', () => {
    expect(fill('{land.seconds} s', { 'land.seconds': '4.3' })).toBe('4.3 s');
    expect(() => fill('{swap.seconds} s', {})).toThrow(/swap.seconds/);
  });

  it('takes seconds only from an ok Runs row holding the shot transaction', () => {
    const vars = runVars([shot({ txids: [TX] }), shot({ scene: 'swap', txids: [DROPPED] })], MEASURED);
    expect(vars).toEqual({ 'land.seconds': '4.3' });
  });

  it('turns marks plus offsets into a window of the clip', () => {
    const s = shot({ marks: [{ at: 1500, what: 'a' }, { at: 9000, what: 'b' }] });
    expect(clipWindow([s], { shot: 'land/chromium-desktop', from: ['a', -2], to: ['b', 1] })).toEqual({ file: 'land.webm', start: 0, end: 10 });
    expect(() => clipWindow([s], { shot: 'land/chromium-desktop', from: ['a', 0], to: ['c', 0] })).toThrow(/no mark "c"/);
  });

  it('uses a shot with a dropped transaction only before the mark where it shows', () => {
    const s = shot({ ok: false, marks: [{ at: 1000, what: 'start' }, { at: 80_000, what: 'converted' }] });
    const clip = { shot: 'land/chromium-desktop', from: ['start', 0] as [string, number], to: ['converted', -1] as [string, number] };
    expect(() => clipWindow([s], clip)).toThrow(/dropped/);
    expect(clipWindow([s], { ...clip, endsBefore: 'converted' }).end).toBe(79);
    expect(() => clipWindow([s], { ...clip, to: ['converted', 2], endsBefore: 'converted' })).toThrow(/runs past/);
  });

  it('lays scenes end to end; a scene lasts as long as its clips, never shorter than its voice', () => {
    const a = { ...captions.audio, leadSeconds: 0.5, tailSeconds: 0.5 };
    const scenes = [{ id: 'x', caption: '', text: '' }, { id: 'y', layout: 'pair' as const, caption: '', text: '' }, { id: 'z', seconds: 6, caption: '', text: '' }];
    const w = (s: number, e: number) => ({ file: 'f', start: s, end: e });
    const placed = placeScenes(scenes, [[w(0, 4), w(10, 13)], [w(0, 5), w(0, 8)], []], [9, 2, 1], a);
    expect(placed.map((p) => [p.start, p.duration])).toEqual([[0, 10], [10, 8], [18, 6]]);
    expect(placed[0]!.voiceAt).toBe(0.5);
  });

  it('splits subtitles at sentence ends and word gaps within the length limit', () => {
    const parts = chunks('Paste your address and you get a landing address. Any wallet can pay it with plain BCH.', 30);
    expect(parts.every((p) => p.length <= 30)).toBe(true);
    expect(parts.join(' ')).toBe('Paste your address and you get a landing address. Any wallet can pay it with plain BCH.');
  });

  it('times subtitle cues from the voice alignment and writes SRT, WebVTT and ASS', () => {
    const text = 'One two. Three';
    const align = { characters: [...text], character_start_times_seconds: [...text].map((_, i) => i * 0.1), character_end_times_seconds: [...text].map((_, i) => i * 0.1 + 0.1) };
    const cues = cueTimes(chunks(text, 40), 10, 2, align);
    expect(cues).toEqual([{ start: 10, end: 10.8, text: 'One two.' }, { start: 10.9, end: 12, text: 'Three' }]);
    expect(srt(cues)).toContain('00:00:10,000 --> 00:00:10,800\nOne two.');
    expect(vtt(cues).startsWith('WEBVTT\n\n00:00:10.000 --> 00:00:10.800')).toBe(true);
    const placed = [{ id: 'x', start: 0, duration: 12, voiceAt: 10, voiceSeconds: 2, windows: [] }];
    const out = ass(captions, placed, cues, ['Caption {x}'], { start: 6, end: 12, lines: ['site.example', 'Narration voice generated with ElevenLabs'] });
    expect(out).toContain('Dialogue: 0,0:00:10.00,0:00:10.80,Sub,,0,0,0,,One two.');
    expect(out).toContain('Caption (x)');
    expect(out).toContain('Narration voice generated with ElevenLabs');
    expect(assColour('#12261f')).toBe('&H001F2612');
  });

  it('keeps the tracked words free of typed numbers and declares the synthetic voice on the end card', () => {
    for (const s of captions.scenes) expect(`${s.caption} ${s.text}`).not.toMatch(/\d+(\.\d+)?\s?s\b/);
    expect(captions.scenes.at(-1)?.card).toContain('Narration voice generated with ElevenLabs');
  });
});
