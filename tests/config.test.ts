import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeConfig, patchConfig, publicConfig, validateConfig, type SampanConfig } from '../core/config.js';

const shipped = JSON.parse(
  readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8'),
) as SampanConfig;
const clone = (): SampanConfig => structuredClone(shipped);

describe('config/sampan.json', () => {
  it('passes validation', () => {
    expect(validateConfig(shipped)).toEqual([]);
  });

  it('has every top-level section the code reads', () => {
    const sections = [
      'tokens', 'defaultToken', 'features', 'route', 'thorchain', 'oneClick', 'evm', 'cauldron', 'electrum', 'wallet', 'connect',
      'landing', 'limits', 'fees', 'rate', 'compliance', 'banner', 'site', 'ops',
    ];
    expect(Object.keys(shipped).sort()).toEqual([...sections].sort());
  });
});

describe('validateConfig', () => {
  it('rejects a token category that is not 32 bytes of hex', () => {
    const c = clone();
    const token = Object.values(c.tokens)[0]!;
    token.category = 'abc';
    expect(validateConfig(c).join()).toMatch(/category/);
  });

  it('accepts a category in either case and loads it in lowercase', () => {
    const c = clone();
    const token = Object.values(c.tokens)[0]!;
    token.category = 'Ab'.repeat(32);
    expect(validateConfig(c)).toEqual([]);
    expect(Object.values(normalizeConfig(c).tokens)[0]!.category).toBe('ab'.repeat(32));
  });

  it('rejects an unknown route and a default token that is not configured', () => {
    const c = clone();
    (c.route as { active: string }).active = 'other';
    c.defaultToken = 'NOPE';
    const errors = validateConfig(c).join('\n');
    expect(errors).toMatch(/route\.active/);
    expect(errors).toMatch(/defaultToken/);
  });

  it('requires a base URL before the near-intents route can be active', () => {
    const c = clone();
    c.route.active = 'near-intents';
    c.oneClick.baseUrl = '';
    expect(validateConfig(c).join()).toMatch(/oneClick\.baseUrl/);
  });

  it('rejects limits where the minimum is not below the maximum', () => {
    const c = clone();
    c.limits.minUsd = c.limits.maxUsd;
    expect(validateConfig(c).join()).toMatch(/limits/);
  });

  it('rejects fewer than three Electrum servers', () => {
    const c = clone();
    c.electrum.servers = c.electrum.servers.slice(0, 2);
    expect(validateConfig(c).join()).toMatch(/electrum/);
  });
});

describe('publicConfig', () => {
  it('leaves out server-only sections and hides MUSD while its flag is off', () => {
    const c = clone();
    c.features.musd = false;
    const pub = publicConfig(c) as unknown as Record<string, unknown>;
    for (const hidden of ['electrum', 'wallet', 'thorchain', 'oneClick', 'cauldron', 'rate', 'ops']) {
      expect(pub).not.toHaveProperty(hidden);
    }
    expect(Object.keys(publicConfig(c).tokens)).toEqual([c.defaultToken]);
  });
});

describe('patchConfig (SAMPAN_CONFIG_PATCH)', () => {
  it('merges objects, replaces values and refuses unknown keys', () => {
    const c = clone();
    const patched = patchConfig(c, JSON.stringify({ features: { swap: true }, rate: { quotesPerMinute: 999 } }));
    expect(patched.features).toEqual({ ...c.features, swap: true });
    expect(patched.rate.quotesPerMinute).toBe(999);
    expect(patched.rate.cloudflareCidrs).toEqual(c.rate.cloudflareCidrs);
    expect(patchConfig(c, undefined)).toBe(c);
    expect(() => patchConfig(c, JSON.stringify({ featurez: {} }))).toThrow(/unknown key featurez/);
  });
});
