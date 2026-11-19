// "Watch it run" (/watch?dir=land): the replay's pace text, the dir query, the measured run it may show, and the
// config it reads (features.watchDemo, site.watch).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateConfig, type SampanConfig } from '../core/config.js';
import { buildProof, landRun } from '../core/proof.js';
import { replayPace, watchDir } from '../core/watch.js';
import { measuredJson } from '../scripts/measured-json.js';

const shipped = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as SampanConfig;
const clone = (): SampanConfig => structuredClone(shipped);

const L = 'a'.repeat(64);
const S = 'b'.repeat(64);
const N = 'c'.repeat(64);
const F = 'd'.repeat(64);
const fixture = [
  '| UTC | flow | amount | txid | seconds | result |',
  '|---|---|---|---|---|---|',
  `| 2026-11-16T19:39:41Z | land | 0.001 BCH to 0.20 PUSD | ${L} | 3.1 | ok |`,
  `| 2026-11-16T19:40:00Z | swap | 0.001 BCH to PUSD | ${S} | 2.0 | ok |`,
  `| 2026-11-16T19:41:00Z | land | 0.001 BCH to 0.20 PUSD (phone) | ${N} | - | ok |`,
  `| 2026-11-16T19:42:00Z | land | 0.001 BCH to 0.20 PUSD | ${F} | 5.0 | fail (gave back) |`,
].join('\n');

describe('replayPace', () => {
  it('says faster when the real run took longer than the replay', () => {
    expect(replayPace(48, 3, 1600)).toEqual({ kind: 'faster', factor: 10, replaySeconds: 4.8 });
  });
  it('says slower when the real run was quicker than the replay', () => {
    expect(replayPace(3.1, 3, 1600)).toEqual({ kind: 'slower', factor: 1.5, replaySeconds: 4.8 });
  });
  it('says real speed within ten per cent either way, and for a time it cannot compare', () => {
    expect(replayPace(5, 3, 1600).kind).toBe('same');
    expect(replayPace(4.5, 3, 1600).kind).toBe('same');
    expect(replayPace(0, 3, 1600)).toEqual({ kind: 'same', factor: 1, replaySeconds: 4.8 });
  });
});

describe('watchDir', () => {
  it('knows the landing only', () => {
    expect(watchDir('?dir=land')).toBe('land');
    expect(watchDir('?dir=out')).toBeNull();
    expect(watchDir('')).toBeNull();
  });
});

describe('landRun (site.watch.land)', () => {
  const p = buildProof(fixture);
  it('finds an ok land row with a measured time by its BCH txid', () => {
    expect(landRun(p, L)!.seconds).toBe(3.1);
    expect(landRun(p, L.toUpperCase())).not.toBeNull();
  });
  it('finds nothing for an empty id, a swap row, a row without a time or a failed row', () => {
    expect(landRun(p, '')).toBeNull();
    expect(landRun(p, S)).toBeNull();
    expect(landRun(p, N)).toBeNull();
    expect(landRun(p, F)).toBeNull();
  });
  it('the shipped site.watch.land, when set, names a run docs/MEASURED.md records', () => {
    if (shipped.site.watch.land) expect(landRun(measuredJson(), shipped.site.watch.land)).not.toBeNull();
  });
});

describe('watch config', () => {
  it('ships valid, with features.watchDemo a boolean', () => {
    expect(validateConfig(shipped)).toEqual([]);
    expect(typeof shipped.features.watchDemo).toBe('boolean');
  });
  it('refuses a flag that is not a boolean, a bad txid and a step length out of range', () => {
    const bad: Array<[string, (c: SampanConfig) => void]> = [
      ['features.watchDemo', (c) => ((c.features as { watchDemo: unknown }).watchDemo = 'yes')],
      ['site.watch.land', (c) => (c.site.watch.land = `0x${L}`)],
      ['site.watch.land', (c) => (c.site.watch.land = L.toUpperCase())],
      ['site.watch.stepMs', (c) => (c.site.watch.stepMs = 100)],
      ['site.watch.stepMs', (c) => (c.site.watch.stepMs = 1500.5)],
    ];
    for (const [key, spoil] of bad) {
      const c = clone();
      spoil(c);
      expect(validateConfig(c).join(), key).toContain(key);
    }
    const ok = clone();
    ok.site.watch.land = '';
    expect(validateConfig(ok)).toEqual([]);
  });
});
