// The Failover table written by tools/measure/failover.ts: cells, health words and replacing the section in place.
import { describe, expect, it } from 'vitest';
import { failoverRow, healthWords, outcomeCell, writeFailoverSection, type FailoverRow } from '../tools/measure/failover-table.js';

const row = (over: Partial<FailoverRow> = {}): FailoverRow => ({
  at: '2026-01-02T03:04:05Z',
  id: 'b',
  broken: 'every server | down',
  firstHealthS: 22.57,
  health: 'pools unknown, BCH servers down',
  quote: { status: 503, ms: 11_795, error: 'chain_unavailable' },
  scan: { status: 200, ms: 80 },
  page: 'Bitcoin Cash not answering',
  commit: 'abc1234',
  ...over,
});

describe('failover table', () => {
  it('writes status, error code and seconds; a route that was not asked says so', () => {
    expect(outcomeCell({ status: 200, ms: 135 })).toBe('200 in 0.1 s');
    expect(outcomeCell({ status: 0, ms: 90_000 })).toBe('no answer in 90.0 s');
    expect(outcomeCell(undefined)).toBe('not asked');
    expect(failoverRow(row())).toBe(
      '| 2026-01-02T03:04:05Z | b | every server / down | 22.6 | pools unknown, BCH servers down | 503 chain_unavailable in 11.8 s | 200 in 0.1 s | not asked | Bitcoin Cash not answering | abc1234 |',
    );
  });

  it('names each provider up, down or unknown, and the route only when it is checked', () => {
    expect(healthWords({ cauldron: null, bch: false, route: null })).toBe('pools unknown, BCH servers down');
    expect(healthWords({ cauldron: true, bch: true, route: { open: false } })).toBe('pools up, BCH servers up, route paused');
    expect(healthWords({ cauldron: true, bch: true, route: { open: null } })).toBe('pools up, BCH servers up, route not answering');
  });

  it('appends the section once, then replaces it in place and keeps the sections around it', () => {
    const doc = '# Measured\n\n## Runs\n\nrow\n\n## Judge path\n\nj\n';
    const first = writeFailoverSection(doc, [row()]);
    expect(first.startsWith(doc)).toBe(true);
    expect(first.match(/## Failover/g)).toHaveLength(1);
    const middle = writeFailoverSection(first.replace('## Failover', '## Failover') + '\n## Later\n\nl\n', [row({ id: 'c' }), row({ id: 'd-base' })]);
    expect(middle.match(/## Failover/g)).toHaveLength(1);
    expect(middle).toContain('\n## Later\n\nl\n');
    expect(middle).toContain('## Judge path\n\nj\n');
    expect(middle).toContain('| c |');
    expect(middle).not.toContain('| b |');
  });
});
