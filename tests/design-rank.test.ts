import { describe, expect, it } from 'vitest';
import { best, rank, type DirectionScore, type Scores } from '../tools/design/rank.js';

const s = (over: Partial<DirectionScore>): DirectionScore => ({ tema: 't', aa: true, skrinPertama: true, limaSaat: 2, perkataan: 50, kaedah: 'proxy', ...over });

describe('rank', () => {
  it('puts a direction that qualifies before one with a better score that does not', () => {
    const scores: Scores = { A: s({ aa: false, limaSaat: 3, perkataan: 10 }), B: s({ limaSaat: 0 }), C: s({ skrinPertama: false, limaSaat: 3 }) };
    expect(rank(scores)[0]).toBe('B');
    expect(best(scores)).toBe('B');
  });
  it('then prefers the higher five-second score', () => {
    expect(rank({ A: s({ limaSaat: 1 }), B: s({ limaSaat: 3, perkataan: 90 }), C: s({ limaSaat: 2 }) })).toEqual(['B', 'C', 'A']);
  });
  it('then the fewer words', () => {
    expect(rank({ A: s({ perkataan: 60 }), B: s({ perkataan: 61 }), C: s({ perkataan: 40 }) })).toEqual(['C', 'A', 'B']);
  });
  it('then A before B before C', () => {
    expect(rank({ A: s({}), B: s({}), C: s({}) })).toEqual(['A', 'B', 'C']);
    expect(rank({ A: s({ aa: false }), B: s({}), C: s({}) })).toEqual(['B', 'C', 'A']);
  });
  it('names no winner when none qualifies', () => {
    expect(best({ A: s({ aa: false }), B: s({ skrinPertama: false }), C: s({ aa: false, skrinPertama: false }) })).toBeUndefined();
  });
});
