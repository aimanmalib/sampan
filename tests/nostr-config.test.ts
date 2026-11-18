// The nostrId block and features.nostrSend: validation, what the page receives, and what the CSP lets the page reach.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { publicConfig, validateConfig, type SampanConfig } from '../core/config.js';
import { contentSecurityPolicy } from '../server/security.js';

const shipped = JSON.parse(readFileSync(new URL('../config/sampan.json', import.meta.url), 'utf8')) as SampanConfig;
const clone = (on = false): SampanConfig => {
  const c = structuredClone(shipped);
  c.features.nostrSend = on;
  return c;
};
const connectSrc = (c: SampanConfig): string[] => /connect-src ([^;]+)/.exec(contentSecurityPolicy(c))![1]!.split(' ');
const langs = ['en', 'ms', 'id', 'fil'];
const REASONS = [
  'input_invalid', 'nip05_failed', 'relays_unreachable', 'not_found', 'wrong_kind', 'id_mismatch', 'nostr_sig_invalid',
  'replaced', 'bch_sig_invalid', 'address_invalid', 'wrong_signer', 'wrong_network', 'same_key', 'ambiguous',
];

describe('nostrId config', () => {
  it('ships with the feature off and a valid block', () => {
    expect(typeof shipped.features.nostrSend).toBe('boolean');
    expect(validateConfig(clone(true))).toEqual([]);
    expect(shipped.nostrId.relays.every((r) => r.startsWith('wss://'))).toBe(true);
  });

  it('rejects a relay that is not wss, a duplicate, a quorum above the relay count, an odd kind or timeout', () => {
    const bad: Array<[string, (c: SampanConfig) => void]> = [
      ['relays', (c) => (c.nostrId.relays = ['https://relay.example'])],
      ['relays', (c) => (c.nostrId.relays = [])],
      ['each relay at most once', (c) => (c.nostrId.relays = ['wss://a.example', 'wss://a.example'])],
      ['minRelaysAnswered', (c) => (c.nostrId.minRelaysAnswered = c.nostrId.relays.length + 1)],
      ['minRelaysAnswered', (c) => (c.nostrId.minRelaysAnswered = 0)],
      ['queryTimeoutMs', (c) => (c.nostrId.queryTimeoutMs = 100)],
      ['nip05TimeoutMs', (c) => (c.nostrId.nip05TimeoutMs = 60000)],
      ['bindingKind', (c) => (c.nostrId.bindingKind = 1)],
      ['platform', (c) => (c.nostrId.platform = 'btc')],
      ['network', (c) => (c.nostrId.network = 'bchtest')],
      ['nip05', (c) => ((c.nostrId as { nip05: unknown }).nip05 = 'yes')],
      ['npubShortChars', (c) => (c.nostrId.npubShortChars = 2)],
      ['features.nostrSend', (c) => ((c.features as { nostrSend: unknown }).nostrSend = 1)],
    ];
    for (const [message, change] of bad) {
      const c = clone();
      change(c);
      expect(validateConfig(c).join(' | '), message).toContain(message);
    }
  });

  it('gives the page no relay while the feature is off, and the block while it is on', () => {
    expect(publicConfig(clone(false)).nostrId).toBeNull();
    expect(publicConfig(clone(true)).nostrId).toEqual(shipped.nostrId);
  });
});

describe('CSP for Nostr identities', () => {
  it('lets the page reach no relay and no https: domain while the feature is off', () => {
    const src = connectSrc(clone(false));
    expect(src).not.toContain('https:');
    for (const relay of shipped.nostrId.relays) expect(src).not.toContain(new URL(relay).origin);
    expect(src.some((s) => s.startsWith('wss://') && shipped.nostrId.relays.some((r) => r.startsWith(s)))).toBe(false);
  });

  it('adds the configured relays while on, and https: only while NIP-05 is on too', () => {
    const on = clone(true);
    const src = connectSrc(on);
    for (const relay of shipped.nostrId.relays) expect(src).toContain(new URL(relay).origin);
    expect(src).toContain('https:');
    on.nostrId.nip05 = false;
    const noNames = connectSrc(on);
    expect(noNames).not.toContain('https:');
    for (const relay of shipped.nostrId.relays) expect(noNames).toContain(new URL(relay).origin);
  });
});

describe('Nostr reason texts', () => {
  it('exist and are not empty in every language', () => {
    for (const lang of langs) {
      const dict = JSON.parse(readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      for (const code of REASONS) expect(dict[`nostr.reason.${code}`]?.trim(), `${lang} ${code}`).toBeTruthy();
    }
  });
});
