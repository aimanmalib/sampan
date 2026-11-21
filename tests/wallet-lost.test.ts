// A connected wallet that goes away must turn into "Wallet disconnected", not "Waiting for your wallet" for ever.
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateConfig, type SampanConfig } from '../core/config.js';
import { watchLost, type LinkSource } from '../web/src/wallet/lost.js';

const AFTER_MS = 20_000;

function manager(): EventEmitter & LinkSource {
  return new EventEmitter();
}

describe('watchLost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a disconnect from the wallet is lost at once', () => {
    const m = manager();
    const onLost = vi.fn();
    watchLost(m, { lostAfterMs: AFTER_MS, readyNow: true, onLost });
    m.emit('disconnect');
    expect(onLost).toHaveBeenCalledTimes(1);
    m.emit('disconnect');
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('reconnecting is still connecting before the limit and lost at the limit', () => {
    const m = manager();
    const onLost = vi.fn();
    watchLost(m, { lostAfterMs: AFTER_MS, readyNow: false, onLost });
    m.emit('walletready');
    m.emit('reconnecting');
    vi.advanceTimersByTime(AFTER_MS - 1);
    expect(onLost).not.toHaveBeenCalled();
    m.emit('reconnecting');
    vi.advanceTimersByTime(1);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('walletready again before the limit keeps the wallet', () => {
    const m = manager();
    const onLost = vi.fn();
    watchLost(m, { lostAfterMs: AFTER_MS, readyNow: true, onLost });
    m.emit('reconnecting');
    vi.advanceTimersByTime(AFTER_MS / 2);
    m.emit('walletready');
    vi.advanceTimersByTime(AFTER_MS * 2);
    expect(onLost).not.toHaveBeenCalled();
    // A later drop starts a fresh count.
    m.emit('reconnecting');
    vi.advanceTimersByTime(AFTER_MS);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('a restore that never reached the wallet is left to the retry hint', () => {
    const m = manager();
    const onLost = vi.fn();
    watchLost(m, { lostAfterMs: AFTER_MS, readyNow: false, onLost });
    m.emit('reconnecting');
    vi.advanceTimersByTime(AFTER_MS * 3);
    expect(onLost).not.toHaveBeenCalled();
  });

  it('stopping removes the listeners and the pending count', () => {
    const m = manager();
    const onLost = vi.fn();
    const stop = watchLost(m, { lostAfterMs: AFTER_MS, readyNow: true, onLost });
    m.emit('reconnecting');
    stop();
    vi.advanceTimersByTime(AFTER_MS);
    m.emit('disconnect');
    expect(onLost).not.toHaveBeenCalled();
    expect(m.listenerCount('disconnect') + m.listenerCount('reconnecting') + m.listenerCount('walletready')).toBe(0);
  });
});

describe('connect.lostAfterSeconds', () => {
  const base = JSON.parse(readFileSync('config/sampan.json', 'utf8')) as SampanConfig;
  it('is a positive integer in the tracked config', () => {
    expect(Number.isInteger(base.connect.lostAfterSeconds) && base.connect.lostAfterSeconds > 0).toBe(true);
  });
  it.each([0, -1, 1.5, undefined])('rejects %s', (bad) => {
    const c = structuredClone(base);
    (c.connect as { lostAfterSeconds?: number | undefined }).lostAfterSeconds = bad;
    expect(validateConfig(c).join()).toMatch(/lostAfterSeconds/);
  });
});
