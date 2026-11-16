// ferryStep: every status of every kind maps to one step, the timeline and the ferry read this same function, and a
// status the page does not know stays on the first step instead of moving the boat on.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ferryStep, type FerryKind, type FerryView } from '../web/src/ferry/step.js';
import en from '../lang/en.json' with { type: 'json' };

const v = (status: string, txid: string | null = null, stage?: string): FerryView => ({ status, txid, out: stage ? { stage } : null });
const brief = (kind: FerryKind, view: FerryView) => {
  const s = ferryStep(kind, view);
  return [s.done, s.step, s.of, s.state, s.paid];
};

describe('ferryStep', () => {
  it('land: open, seen, converted, returned', () => {
    expect(brief('land', v('open'))).toEqual([1, 1, 4, 'moving', false]);
    expect(brief('land', v('seen'))).toEqual([2, 2, 4, 'moving', true]);
    expect(brief('land', v('converted', 'aa'))).toEqual([4, 4, 4, 'arrived', true]);
    expect(brief('land', v('returned', 'aa'))).toEqual([3, 1, 3, 'returned', true]);
    expect(ferryStep('land', v('returned')).steps).toEqual(['waiting', 'seen', 'returned']);
  });

  it('out and in: built, sent, seen by the route, paid, refunded, failed', () => {
    for (const kind of ['out', 'in'] as const) {
      expect(brief(kind, v('built'))).toEqual([0, 1, 3, 'moving', false]);
      expect(brief(kind, v('broadcast', 'aa', 'unseen'))).toEqual([1, 1, 3, 'moving', true]);
      expect(brief(kind, v('broadcast', 'aa', 'pending'))).toEqual([2, 2, 3, 'moving', true]);
      expect(brief(kind, v('broadcast', 'aa', 'done'))).toEqual([3, 3, 3, 'arrived', true]);
      expect(brief(kind, v('completed', 'aa', 'done'))).toEqual([3, 3, 3, 'arrived', true]);
      expect(brief(kind, v('refunded', 'aa', 'refunded'))).toEqual([3, 1, 3, 'returned', true]);
      expect(brief(kind, v('failed', 'aa', 'unknown'))).toEqual([1, 1, 3, 'failed', true]);
    }
  });

  it('swap: built, sent, stale, failed', () => {
    expect(brief('swap', v('built'))).toEqual([1, 1, 2, 'moving', false]);
    expect(brief('swap', v('broadcast', 'aa'))).toEqual([2, 2, 2, 'arrived', true]);
    expect(brief('swap', v('stale'))).toEqual([1, 1, 2, 'failed', false]);
    expect(brief('swap', v('failed'))).toEqual([0, 1, 2, 'failed', false]);
  });

  it('a status it does not know stays on the first step and does not move the boat on', () => {
    for (const kind of ['land', 'swap'] as const) {
      const s = ferryStep(kind, v('something-new', 'aa'));
      expect([s.done, s.step]).toEqual([1, 1]);
    }
    for (const kind of ['out', 'in'] as const) {
      const s = ferryStep(kind, v('something-new', 'aa', 'something-new'));
      expect([s.done, s.step]).toEqual([1, 1]);
    }
  });

  it('the boat is never before the first bank or past the far one', () => {
    const statuses = ['open', 'seen', 'converted', 'returned', 'built', 'broadcast', 'completed', 'refunded', 'failed', 'stale', 'x'];
    const stages = [undefined, 'unseen', 'pending', 'done', 'refunded', 'unknown'];
    for (const kind of ['land', 'out', 'in', 'swap'] as const)
      for (const status of statuses)
        for (const stage of stages)
          for (const txid of [null, 'aa']) {
            const s = ferryStep(kind, v(status, txid, stage));
            expect(s.step).toBeGreaterThanOrEqual(1);
            expect(s.step).toBeLessThanOrEqual(s.of);
            expect(s.of).toBe(s.steps.length);
            expect(s.done).toBeLessThanOrEqual(s.of);
          }
  });

  it('every step has its timeline words in lang/en.json', () => {
    const keys = new Set(Object.keys(en));
    const prefix: Record<FerryKind, string> = { land: 'crossing.land.step.', out: 'crossing.out.step.', in: 'crossing.in.step.', swap: 'crossing.step.' };
    for (const kind of ['land', 'out', 'in', 'swap'] as const)
      for (const status of ['open', 'returned'])
        for (const step of ferryStep(kind, v(status)).steps) expect(keys.has(`${prefix[kind]}${step}`)).toBe(true);
  });

  it('the timelines of the status pages count their steps with ferryStep, not with a function of their own', () => {
    const read = (p: string): string => readFileSync(new URL(`../web/src/${p}`, import.meta.url), 'utf8');
    for (const [file, kind] of [
      ['land/LandingStatus.tsx', "'land'"],
      ['out/OutStatus.tsx', 'direction'],
      ['CrossingPage.tsx', "'swap'"],
    ] as const) {
      const src = read(file);
      expect(src).toContain(`ferryStep(${kind}`);
      expect(src).toMatch(/at\.steps\.map\(/);
      expect(src).not.toMatch(/function reached\(|const reached =|_STEPS = \[/);
    }
  });
});
