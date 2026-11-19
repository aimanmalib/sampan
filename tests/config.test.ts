import { allOff, assetsOff } from './helpers/cross-off.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeConfig, patchConfig, publicConfig, validateConfig, type SampanConfig } from '../core/config.js';
import { livePatch } from '../core/route-assets.js';

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
      'tokens', 'defaultToken', 'features', 'route', 'thorchain', 'oneClick', 'nostrId', 'evm', 'cauldron', 'electrum', 'wallet', 'connect',
      'landing', 'limits', 'fees', 'rate', 'compliance', 'banner', 'judge', 'site', 'legal', 'ops', 'business', 'peg', 'pay', 'keepCompare', 'ui', 'i18n', 'atom',
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

  it('takes site.finished as a lower case BCH txid or empty, nothing else', () => {
    const c = clone();
    c.site.finished = { out: '', in: 'ab'.repeat(32) };
    expect(validateConfig(c)).toEqual([]);
    c.site.finished = { out: `0x${'ab'.repeat(32)}`, in: 'AB'.repeat(32) };
    expect(validateConfig(c).join()).toMatch(/site\.finished/);
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

  it('keeps one list of route assets: route.symbols must repeat the live symbols, and thorchain.chains is refused', () => {
    const c = allOff(clone()) as SampanConfig & { thorchain: { chains?: string[] } };
    c.route.symbols = ['USDC'];
    c.thorchain.chains = ['BASE'];
    const errors = validateConfig(c).join('\n');
    expect(errors).toMatch(/route\.symbols: must be the symbols of the live thorchain\.assets \(none\)/);
    expect(errors).toMatch(/thorchain\.chains: removed/);
    const live = patchConfig(allOff(clone()), JSON.stringify(livePatch(assetsOff(clone().thorchain.assets), ['ETH'])));
    expect(live.route.symbols).toEqual(['USDC', 'USDT']);
    expect(validateConfig(live)).toEqual([]);
    live.route.symbols = ['USDC'];
    expect(validateConfig(live).join()).toMatch(/route\.symbols: must be the symbols of the live thorchain\.assets \(USDC, USDT\)/);
  });

  it('checks each asset against its chain entry: name, contract, token, live flags; a chain without an EVM entry is never live', () => {
    const c = clone();
    const eth = c.thorchain.assets.find((a) => a.chain === 'ETH')!;
    eth.asset = eth.asset.replace(/.$/, '0');
    const bsc = c.thorchain.assets.find((a) => a.chain === 'BSC')!;
    bsc.symbol = 'DAI';
    const tron = c.thorchain.assets.find((a) => a.chain === 'TRON')!;
    tron.live = { out: true, in: false };
    c.thorchain.assets.push({ ...c.thorchain.assets[2]! });
    const errors = validateConfig(c).join('\n');
    expect(errors).toMatch(/contract differs from evm\.chains\.ETH/);
    expect(errors).toMatch(/BSC\.USDC-.*must read CHAIN\.SYMBOL-CONTRACT/);
    expect(errors).toMatch(/TRON\.USDT-.*live needs an evm\.chains entry/);
    expect(errors).toMatch(/listed twice/);
    expect(validateConfig({ ...clone(), thorchain: { ...clone().thorchain, assets: [] } }).join()).toMatch(/thorchain\.assets: at least one/);
  });

  it('wants two https RPC endpoints, the gas coin and token decimals for every EVM chain', () => {
    const c = clone();
    c.evm.chains[0]!.rpc = [c.evm.chains[0]!.rpc[0]!];
    c.evm.chains[1]!.tokens.USDC!.decimals = 1.5;
    c.evm.chains[2]!.native = { name: '', symbol: 'AVAX' };
    const errors = validateConfig(c).join('\n');
    expect(errors).toMatch(/evm\.chains\.ETH\.rpc: at least two https URLs/);
    expect(errors).toMatch(/evm\.chains\.BSC\.tokens\.USDC\.decimals/);
    expect(errors).toMatch(/evm\.chains\.AVAX\.native/);
  });

  it('publishes only live assets, with symbols and chains derived from them', () => {
    expect(publicConfig(clone()).routeAssets.every((a) => a.live.out || a.live.in)).toBe(true);
    const c = clone();
    c.thorchain.assets = c.thorchain.assets.map((a) => (a.chain === 'ETH' && a.symbol === 'USDC' ? { ...a, live: { out: true, in: false } } : { ...a, live: { out: false, in: false } }));
    const p = publicConfig(c);
    expect(p.routeAssets.map((a) => a.asset)).toEqual([c.thorchain.assets.find((a) => a.live.out)!.asset]);
    expect([p.route.symbols, p.routeChains]).toEqual([['USDC'], ['ETH']]);
    c.route.active = 'none';
    expect(publicConfig(c).routeAssets).toEqual([]);
  });

  it('requires a base URL before the near-intents route can be active', () => {
    const c = clone();
    c.route.active = 'near-intents';
    c.oneClick.baseUrl = '';
    expect(validateConfig(c).join()).toMatch(/oneClick\.baseUrl/);
  });

  it('refuses a 1Click out deadline shorter than a few BCH blocks (2026-11-18: 30 min expired before a 24 min block)', () => {
    const c = clone();
    expect(validateConfig(c).join()).not.toMatch(/deadlineMinutes/);
    c.oneClick.deadlineMinutes.out = 30;
    expect(validateConfig(c).join()).toMatch(/oneClick\.deadlineMinutes\.out/);
    c.oneClick.deadlineMinutes.out = 120;
    c.oneClick.minOutDeadlineBchBlocks = 0;
    expect(validateConfig(c).join()).toMatch(/minOutDeadlineBchBlocks/);
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
    for (const hidden of ['electrum', 'wallet', 'thorchain', 'cauldron', 'rate', 'ops']) {
      expect(pub).not.toHaveProperty(hidden);
    }
    // 1Click: which assets are offered and the page's timings only; no host, user agent, asset id or key (ADR 0050).
    const oc = publicConfig(c).oneClick;
    expect(Object.keys(oc).sort()).toEqual(['assets', 'deadlineMinutes', 'dryDebounceMs', 'statusPollSeconds']);
    for (const a of oc.assets) expect(Object.keys(a).sort()).toEqual(['chain', 'live', 'symbol']);
    expect(JSON.stringify(pub)).not.toMatch(/chaindefuser|nep141|userAgent|placeholders/i);
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
    expect(publicConfig(shipped).ui.ferryMotion).toBe(shipped.ui.ferryMotion);
    const bad = { ...shipped, ui: { ...shipped.ui, ferryMotion: 'yes' } } as unknown as typeof shipped;
    expect(validateConfig(bad)).toContain('ui.ferryMotion: true or false');
  });
});

describe('ui.qrAutoOpen', () => {
  it('is a boolean in the shipped config, is sent to the page as it is, and must be a boolean', () => {
    expect(typeof shipped.ui.qrAutoOpen).toBe('boolean');
    expect(publicConfig(shipped).ui.qrAutoOpen).toBe(shipped.ui.qrAutoOpen);
    const missing = { ...shipped, ui: { ...shipped.ui, qrAutoOpen: undefined } } as unknown as typeof shipped;
    expect(validateConfig(missing)).toContain('ui.qrAutoOpen: true or false');
    expect(validateConfig({ ...shipped, ui: { ...shipped.ui, qrAutoOpen: false } })).toEqual([]);
  });
});

describe('ui.qrCloseMs and ui.arriveMs', () => {
  it('are whole milliseconds inside their ranges in the shipped config and reach the page as they are', () => {
    expect(validateConfig(shipped)).toEqual([]);
    expect(publicConfig(shipped).ui.qrCloseMs).toBe(shipped.ui.qrCloseMs);
    expect(publicConfig(shipped).ui.arriveMs).toBe(shipped.ui.arriveMs);
  });
  it.each([
    ['qrCloseMs', 149, 'ui.qrCloseMs: an integer from 150 to 1500'],
    ['qrCloseMs', 1501, 'ui.qrCloseMs: an integer from 150 to 1500'],
    ['qrCloseMs', 400.5, 'ui.qrCloseMs: an integer from 150 to 1500'],
    ['qrCloseMs', '400', 'ui.qrCloseMs: an integer from 150 to 1500'],
    ['arriveMs', 799, 'ui.arriveMs: an integer from 800 to 6000'],
    ['arriveMs', 6001, 'ui.arriveMs: an integer from 800 to 6000'],
    ['arriveMs', undefined, 'ui.arriveMs: an integer from 800 to 6000'],
  ])('rejects ui.%s = %s', (key, value, message) => {
    const bad = { ...shipped, ui: { ...shipped.ui, [key]: value } } as unknown as typeof shipped;
    expect(validateConfig(bad)).toContain(message);
  });
  it('accepts both ends of each range', () => {
    for (const ui of [{ qrCloseMs: 150, arriveMs: 800 }, { qrCloseMs: 1500, arriveMs: 6000 }]) {
      expect(validateConfig({ ...shipped, ui: { ...shipped.ui, ...ui } })).toEqual([]);
    }
  });
});

describe('ui.themes and ui.theme', () => {
  it('ship a theme file for every listed theme, include paper, and send only the chosen theme to the page', () => {
    expect(validateConfig(shipped)).toEqual([]);
    expect(shipped.ui.themes).toContain('paper');
    expect(shipped.ui.themes).toContain(shipped.ui.theme);
    for (const name of shipped.ui.themes) {
      const css = readFileSync(new URL(`../web/src/themes/${name}.css`, import.meta.url), 'utf8');
      expect(css, `${name}.css scopes its tokens`).toContain(`:root[data-theme='${name}']`);
    }
    expect(publicConfig(shipped).ui.theme).toBe(shipped.ui.theme);
    expect(publicConfig(shipped).ui).not.toHaveProperty('themes');
  });
  it.each([
    [{ theme: 'dusk' }, 'ui.theme: one of ui.themes'],
    [{ theme: undefined }, 'ui.theme: one of ui.themes'],
    [{ themes: ['night'], theme: 'night' }, 'ui.themes: must include "paper", the way back'],
    [{ themes: [] }, 'ui.themes: a list of distinct lower-case theme names'],
    [{ themes: ['paper', 'paper'] }, 'ui.themes: a list of distinct lower-case theme names'],
    [{ themes: ['paper', 'Night'] }, 'ui.themes: a list of distinct lower-case theme names'],
  ])('rejects ui %o', (ui, message) => {
    const bad = { ...shipped, ui: { ...shipped.ui, ...ui } } as unknown as typeof shipped;
    expect(validateConfig(bad)).toContain(message);
  });
  it('accepts a second listed theme as the chosen one', () => {
    expect(validateConfig({ ...shipped, ui: { ...shipped.ui, themes: ['paper', 'night'], theme: 'night' } })).toEqual([]);
  });
});

describe('ui.icons', () => {
  it('names an icon file that exists for every entry, and reaches the page', () => {
    for (const [name, file] of Object.entries(shipped.ui.icons)) {
      expect(() => readFileSync(new URL(`../web/src/icons/${file}.svg`, import.meta.url)), `${name} → ${file}.svg`).not.toThrow();
    }
    expect(publicConfig(shipped).ui.icons).toEqual(shipped.ui.icons);
  });
  it.each([[undefined], [[]], [{ BCH: 'BCH' }], [{ BCH: '../bch' }], [{ 'B C': 'bch' }], [{ BCH: 3 }]])('rejects ui.icons %o', (icons) => {
    const bad = { ...shipped, ui: { ...shipped.ui, icons } } as unknown as typeof shipped;
    expect(validateConfig(bad)).toContain('ui.icons: an object of name → icon file name (lower-case letters, digits, dashes)');
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
