// The word "My activity" shows for each crossing comes from its kind and the status the server really writes
// (ADR 0076). A crossing out or in is "done" only once the route said so and the status page stored it.
import { describe, expect, it } from 'vitest';
import { ACTIVITY_STATES, UNSIGNED, activityState } from '../core/activity.js';

describe('activityState', () => {
  it('reads a swap as done once broadcast, not sent when stale or failed, and hides a quote never signed', () => {
    expect(activityState('swap', 'broadcast')).toBe('done');
    expect(activityState('swap', 'stale')).toBe('failed');
    expect(activityState('swap', 'failed')).toBe('failed');
    expect(activityState('swap', 'built')).toBeNull();
  });

  it('reads a landing as in progress until the watcher converts or returns the coins', () => {
    expect(activityState('land', 'open')).toBe('open');
    expect(activityState('land', 'seen')).toBe('open');
    expect(activityState('land', 'converted')).toBe('done');
    expect(activityState('land', 'returned')).toBe('refunded');
  });

  it('never reads a crossing out as done when only its deposit was broadcast', () => {
    expect(activityState('out', 'broadcast')).toBe('sent');
    expect(activityState('out', 'built')).toBeNull();
    expect(activityState('out', 'stale')).toBe('failed');
    expect(activityState('out', 'failed')).toBe('failed');
    expect(activityState('out', 'completed')).toBe('done');
    expect(activityState('out', 'refunded')).toBe('refunded');
  });

  it('reads a crossing in as sent, never in progress for ever, until the status page stores the route answer', () => {
    expect(activityState('in', 'sent')).toBe('sent');
    expect(activityState('in', 'planned')).toBeNull();
    expect(activityState('in', 'completed')).toBe('done');
    expect(activityState('in', 'refunded')).toBe('refunded');
    expect(activityState('in', 'failed')).toBe('failed');
  });

  it('reads a status it does not know as sent, open it for the status', () => {
    expect(activityState('out', 'something new')).toBe('sent');
    expect(activityState('swap', 'toString')).toBe('sent');
  });

  it('leaves out exactly the statuses of quotes never signed', () => {
    expect([...UNSIGNED].sort()).toEqual([
      ['in', 'planned'],
      ['out', 'built'],
      ['swap', 'built'],
    ]);
    for (const [kind, status] of UNSIGNED) expect(ACTIVITY_STATES[kind][status]).toBeNull();
  });
});
