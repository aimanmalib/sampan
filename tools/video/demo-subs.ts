// Subtitle tracks of the /demo video in the page's languages other than English (ADR 0082). English comes from the
// edit itself (timed by the narration's own alignment); every other language takes the scene's text from
// lang/<code>.json (`demo.sub.<scene>`) and spreads its chunks over the same narration span by share of length.
// Pure, so tests/demo-files.test.ts can check that the tracked .vtt files are what this writes.
import type { DemoFile } from '../../core/demo.js';
import { cueTimes, vtt } from './plan.js';

/**
 * Splits a line into subtitle chunks of at most `max` characters: at sentence ends (a full stop followed by a space) first, then each sentence into the
 * fewest lines of even length (no one-word line left at the end of a sentence).
 */
export function evenChunks(text: string, max: number): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    const length = words.join(' ').length;
    for (let parts = Math.max(1, Math.ceil(length / max)); ; parts += 1) {
      const target = length / parts;
      const lines: string[] = [];
      let cur = '';
      for (const word of words) {
        const next = cur ? `${cur} ${word}` : word;
        if (cur && (next.length > max || (lines.length < parts - 1 && next.length > target + 1 && Math.abs(next.length - target) > Math.abs(cur.length - target)))) {
          lines.push(cur);
          cur = word;
        } else cur = next;
      }
      if (cur) lines.push(cur);
      if ((lines.length <= parts && lines.every((l) => l.length <= max)) || parts >= words.length) {
        out.push(...lines);
        break;
      }
    }
  }
  return out;
}

export const subKey = (scene: string): string => `demo.sub.${scene}`;

/** The WebVTT track of one language; a scene whose text is missing is an error, never a silent gap. */
export function translatedTrack(file: DemoFile, text: Record<string, string>, maxChars: number): string {
  const cues = file.scenes.flatMap((s) => {
    const line = text[subKey(s.id)];
    if (!line) throw new Error(`no ${subKey(s.id)} text`);
    return cueTimes(evenChunks(line, maxChars), s.voiceAt, s.voiceSeconds);
  });
  return vtt(cues);
}

/** Track file name of a language, beside the video. */
export const trackName = (video: string, code: string): string => video.replace(/\.mp4$/, `.${code}.vtt`);
