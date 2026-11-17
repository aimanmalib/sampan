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
      'landing', 'limits', 'fees', 'rate', 'compliance', 'banner', 'site', 'legal', 'ops', 'business', 'pay', 'ui', 'i18n', 'atom',
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

  it('rejects a site origin with a trailing slash and a preview picture that is not a PNG path', () => {
    const c = clone();
    c.site.url = 'https://example.test/';
    c.site.ogImage = 'og.jpg';
    const errors = validateConfig(c).join();
    expect(errors).toMatch(/site\.url/);
    expect(errors).toMatch(/site\.ogImage/);
  });

  it('rejects an empty operator name and legal sections with a bad or repeated key', () => {
    const c = clone();
    c.legal.operator = ' ';
    c.legal.terms = [{ key: 'final' }, { key: 'final' }];
    c.legal.risks = [{ key: 'bad-key' }];
    const errors = validateConfig(c).join('\n');
    expect(errors).toMatch(/legal\.operator/);
    expect(errors.match(/legal\.terms, legal\.risks/g)).toHaveLength(2);
    expect(validateConfig({ ...clone(), legal: { ...clone().legal, risks: [] } }).join()).toMatch(/legal\.terms/);
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

  it('rejects a wallet scan cache long enough to hide coins that arrive after the first scan', () => {
    const c = clone();
    c.wallet.scanCacheSeconds = 600;
    expect(validateConfig(c).join()).toMatch(/scanCacheSeconds/);
  });

  it('rejects a missing or non-positive wait before the wallet retry hint, and sends it to the page', () => {
    expect(publicConfig(clone()).connect.retryHintSeconds).toBeGreaterThan(0);
    for (const bad of [0, -1, 1.5, undefined]) {
      const c = clone();
      (c.connect as { retryHintSeconds?: number | undefined }).retryHintSeconds = bad;
      expect(validateConfig(c).join()).toMatch(/retryHintSeconds/);
    }
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

describe('ui.ferryMotion', () => {
  it('is a boolean in the shipped config, is sent to the page as it is, and must be a boolean', () => {
    expect(typeof shipped.ui.ferryMotion).toBe('boolean');
    expect(publicConfig(shipped).ui).toEqual({ ferryMotion: shipped.ui.ferryMotion });
    const bad = { ...shipped, ui: { ferryMotion: 'yes' } } as unknown as typeof shipped;
    expect(validateConfig(bad)).toContain('ui.ferryMotion: true or false');
  });
});

describe('i18n', () => {
  it('reaches the page as the language list and default', () => {
    expect(publicConfig(shipped).i18n).toEqual(shipped.i18n);
    expect(shipped.i18n.languages.map((l) => l.code)).toContain(shipped.i18n.default);
  });

  it('rejects a default it does not list, a code twice, a list without en and a language with no name', () => {
    const c = clone();
    c.i18n.default = 'zz';
    expect(validateConfig(c)).toContain('i18n.default: one of the i18n.languages codes');
    const twice = clone();
    twice.i18n.languages.push({ ...twice.i18n.languages[0]! });
    expect(validateConfig(twice).join()).toMatch(/no code twice/);
    const noEn = clone();
    noEn.i18n = { default: 'ms', languages: [{ code: 'ms', name: 'Bahasa Melayu' }] };
    expect(validateConfig(noEn).join()).toMatch(/and en/);
    const unnamed = clone();
    unnamed.i18n.languages[0]!.name = ' ';
    expect(validateConfig(unnamed).join()).toMatch(/i18n.languages: \{ code, name \}/);
    const machine = clone();
    (machine.i18n.languages[0] as { machine?: unknown }).machine = 'yes';
    expect(validateConfig(machine)).toContain('i18n.languages: machine is true or false');
  });

  it('marks every software translation it offers, and never English', () => {
    for (const l of shipped.i18n.languages) expect(typeof (l as { machine?: unknown }).machine, l.code).toMatch(/^(undefined|boolean)$/);
    expect((shipped.i18n.languages.find((l) => l.code === 'en') as { machine?: boolean }).machine).not.toBe(true);
  });
});
