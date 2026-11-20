// The main message in under a minute, without the video (K6P4): what Sampan is, why it is for you, and the proof. The
// three lines are lang keys pitch.what / pitch.why / pitch.proof; the proof's numbers are the front page headline counted
// from docs/MEASURED.md (core/client/measured.ts Headline), never typed. The assets in "why" are the open ones the caller
// passes (config and health, as the hero sub names them); with none open, pitch.whyBch says the BCH half only.
// The hero, slide 1 of the deck and the event page description read the same keys.
import type { Headline } from './client/measured.js';

export const PITCH_KEYS = ['pitch.what', 'pitch.why', 'pitch.proof'] as const;
export type PitchKey = (typeof PITCH_KEYS)[number] | 'pitch.whyBch';

export interface Pitch {
  what: string;
  why: string;
  proof: string;
}

/** The three lines in one language; `t` fills {placeholders} the way the page does; `symbols` is a joined asset list. */
export function pitchLines(h: Headline, t: (key: PitchKey, vars?: Record<string, string>) => string, symbols: string): Pitch {
  return {
    what: t('pitch.what'),
    why: symbols ? t('pitch.why', { symbols }) : t('pitch.whyBch'),
    proof: t('pitch.proof', { crossings: String(h.crossings), chains: String(h.chains.length), txids: String(h.txids) }),
  };
}

/** Words a reader reads in the three templates; a {placeholder} counts as one word (a number or a list). */
export function pitchWords(text: Record<string, string | undefined>): number {
  return PITCH_KEYS.reduce((n, k) => n + (text[k] ?? '').replace(/\{[^}]*\}/g, 'N').split(/\s+/).filter(Boolean).length, 0);
}

/** The three lines from a language file (lang/<code>.json), outside the page: the deck, tests and the event text. */
export function pitchFrom(text: Record<string, string | undefined>, h: Headline, symbols: string): Pitch {
  return pitchLines(h, (k, vars = {}) => (text[k] ?? '').replace(/\{(\w+)\}/g, (m, n: string) => vars[n] ?? m), symbols);
}
