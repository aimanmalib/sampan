import { describe, expect, it } from 'vitest';
import en from '../lang/en.json' with { type: 'json' };
import { measuredParts, type Counts, type MeasuredKey } from '../core/client/measured.js';

const t = (key: MeasuredKey, vars: Record<string, string> = {}) => en[key].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
const counts = (c: Partial<Counts>): Counts => ({ completed: 0, returned: 0, lost: 0, medianSeconds: null, ...c });

describe('Measured line', () => {
  it('hides the other-people part while it is zero and shows short medians in seconds', () => {
    const parts = measuredParts({ all: counts({ completed: 4, returned: 1, medianSeconds: 2.6 }), public: counts({}) }, t);
    expect(parts).toEqual(['4 landings and crossings completed', 'median 3 s from payment to conversion', '1 given back', '0 lost']);
  });

  it('names how many were made by other people and shows long medians in minutes', () => {
    const parts = measuredParts({ all: counts({ completed: 9, lost: 1, medianSeconds: 600 }), public: counts({ completed: 2 }) }, t);
    expect(parts).toContain('2 of them by other people');
    expect(parts).toContain('median 10 min from payment to conversion');
    expect(parts).toContain('1 lost');
  });
});
