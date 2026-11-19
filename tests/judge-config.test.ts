// config.judge.openOnPhone (KMN4): shipped as a boolean, refused otherwise, and passed to the page's config.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicConfig, validateConfig, type SampanConfig } from '../core/config.js';

const shipped = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as SampanConfig;
const clone = (): SampanConfig => structuredClone(shipped);

describe('judge.openOnPhone', () => {
  it('ships valid as a boolean', () => {
    expect(validateConfig(shipped)).toEqual([]);
    expect(typeof shipped.judge.openOnPhone).toBe('boolean');
  });
  it('refuses a missing section and a value that is not a boolean', () => {
    const missing = clone() as unknown as Record<string, unknown>;
    delete missing.judge;
    expect(validateConfig(missing as unknown as SampanConfig).join()).toContain('judge.openOnPhone');
    const text = clone();
    (text.judge as { openOnPhone: unknown }).openOnPhone = 'yes';
    expect(validateConfig(text).join()).toContain('judge.openOnPhone');
  });
  it('reaches the page config either way', () => {
    for (const openOnPhone of [true, false]) {
      const c = clone();
      c.judge.openOnPhone = openOnPhone;
      expect(publicConfig(c).judge).toEqual({ openOnPhone });
    }
  });
});
