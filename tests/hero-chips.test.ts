import { describe, expect, it } from 'vitest';
import { chainChips, pegPrice } from '../core/hero-chips.js';
import { refreshBlocked } from '../web/src/quote/refresh.js';

const row = (key: string, name: string, open: boolean) => ({ chain: { key, name }, open });

describe('chainChips', () => {
  it('lists each chain once in order, open when either direction is open', () => {
    const out = [row('ETH', 'Ethereum', true), row('BSC', 'BNB Smart Chain', false), row('ETH', 'Ethereum', false)];
    const inn = [row('BSC', 'BNB Smart Chain', true), row('BASE', 'Base', false)];
    expect(chainChips(out, inn)).toEqual([
      { key: 'ETH', name: 'Ethereum', open: true },
      { key: 'BSC', name: 'BNB Smart Chain', open: true },
      { key: 'BASE', name: 'Base', open: false },
    ]);
  });
  it('keeps a paused chain in the list instead of hiding it', () => {
    expect(chainChips([row('AVAX', 'Avalanche', false)], [])).toEqual([{ key: 'AVAX', name: 'Avalanche', open: false }]);
  });
});

describe('pegPrice', () => {
  it('turns the peg gap into a four-decimal dollar price', () => {
    expect(pegPrice({ pegBps: 0 })).toBe('1.0000');
    expect(pegPrice({ pegBps: -13 })).toBe('0.9987');
    expect(pegPrice({ pegBps: 25 })).toBe('1.0025');
  });
  it('is null when the BCH price is unknown (no number shown)', () => {
    expect(pegPrice({ pegBps: null })).toBeNull();
  });
});

describe('refreshBlocked', () => {
  const doc = (visibilityState: DocumentVisibilityState, dialog: boolean) => ({
    visibilityState,
    querySelector: (sel: string) => (dialog && sel.includes('dialog[open]') ? ({} as Element) : null),
  }) as unknown as Pick<Document, 'visibilityState' | 'querySelector'>;
  it('lets a visible page with no dialog refresh', () => {
    expect(refreshBlocked(doc('visible', false))).toBe(false);
  });
  it('waits while the tab is hidden or a dialog is open', () => {
    expect(refreshBlocked(doc('hidden', false))).toBe(true);
    expect(refreshBlocked(doc('visible', true))).toBe(true);
  });
});
