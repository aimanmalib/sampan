// Orders the three look directions by their measured score (ADR 0057). The rule, in order:
//   1. qualifies: no colour-contrast failure (aa) and the whole first screen on an iPhone in every language;
//   2. the higher five-second score (0 to 3);
//   3. the fewer words on the first phone screen;
//   4. A before B before C.
export const LETTERS = ['A', 'B', 'C'] as const;
export type Letter = (typeof LETTERS)[number];

export interface DirectionScore {
  /** The theme name (config ui.themes). */
  tema: string;
  /** axe colour-contrast found nothing on / and /how, every language, both engines. */
  aa: boolean;
  /** The first-screen rule held on an iPhone 13 in every language. */
  skrinPertama: boolean;
  /** Five-second test, 0 to 3. */
  limaSaat: number;
  /** Words visible on the first iPhone 13 screen in English. */
  perkataan: number;
  /** How limaSaat was scored: a fresh model session, or the mechanical proxy. */
  kaedah: string;
}

export type Scores = Record<Letter, DirectionScore>;

export const qualifies = (s: DirectionScore): boolean => s.aa && s.skrinPertama;

/** The letters best first. */
export function rank(scores: Scores): Letter[] {
  const key = (l: Letter): [number, number, number, number] => {
    const s = scores[l];
    return [qualifies(s) ? 0 : 1, -s.limaSaat, s.perkataan, LETTERS.indexOf(l)];
  };
  return [...LETTERS].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return 0;
  });
}

/** The winner, or undefined when no direction qualifies. */
export function best(scores: Scores): Letter | undefined {
  const top = rank(scores)[0]!;
  return qualifies(scores[top]) ? top : undefined;
}
