import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicConfig, type SampanConfig } from '../core/config.js';
import { fillPageMeta, pngSize, type PageMetaConfig } from '../core/page-meta.js';

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const html = read('web/index.html');
const en = JSON.parse(read('lang/en.json')) as Record<string, string>;
// The public part, as the page build (vite.config.ts) passes it.
const shipped: PageMetaConfig = publicConfig(JSON.parse(read('config/sampan.json')) as SampanConfig);
const ogBytes = readFileSync(new URL(`../web/public${shipped.site.ogImage}`, import.meta.url));

/** A frozen config so the test does not depend on which flows the owner has switched on. */
const config: PageMetaConfig = {
  ...shipped,
  site: { url: 'https://example.test', ogImage: '/og.png' },
};

const meta = (out: string, attr: 'property' | 'name', key: string): string | undefined =>
  new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(out)?.[1];

describe('link preview picture', () => {
  it('is a 1200 x 630 PNG under 300 KB', () => {
    expect(pngSize(ogBytes)).toEqual({ width: 1200, height: 630 });
    expect(ogBytes.length).toBeLessThan(300 * 1024);
  });

  it('rejects a file that is not a PNG', () => {
    expect(() => pngSize(new TextEncoder().encode('<svg></svg> padding padding'))).toThrow(/PNG/);
  });
});

describe('fillPageMeta', () => {
  const out = fillPageMeta(html, en, config, ogBytes);

  it('leaves no placeholder behind', () => {
    expect(out).not.toMatch(/%(lang|flows|site):/);
  });

  it('writes the Open Graph and Twitter tags with absolute URLs', () => {
    const image = meta(out, 'property', 'og:image');
    expect(image).toMatch(/^https:\/\/example\.test\/og\.png\?v=[0-9a-f]{8}$/);
    expect(meta(out, 'name', 'twitter:image')).toBe(image);
    expect(meta(out, 'property', 'og:url')).toBe('https://example.test/');
    expect(meta(out, 'property', 'og:image:width')).toBe('1200');
    expect(meta(out, 'property', 'og:image:height')).toBe('630');
    expect(meta(out, 'name', 'twitter:card')).toBe('summary_large_image');
  });

  it('uses the page title and the same description as the description tag', () => {
    const description = meta(out, 'name', 'description');
    expect(description).toBeTruthy();
    expect(meta(out, 'property', 'og:description')).toBe(description);
    expect(meta(out, 'name', 'twitter:description')).toBe(description);
    expect(meta(out, 'property', 'og:title')).toBe(en['meta.title']);
  });

  it('changes the picture URL when the picture changes', () => {
    const other = Uint8Array.from(ogBytes);
    other[other.length - 1] = other[other.length - 1]! ^ 0xff;
    const image2 = meta(fillPageMeta(html, en, config, other), 'property', 'og:image');
    expect(image2).not.toBe(meta(out, 'property', 'og:image'));
  });

  it('writes the theme from config into <html data-theme>', () => {
    expect(out).toMatch(new RegExp(`<html lang="en" data-theme="${shipped.ui.theme}">`));
    const night = fillPageMeta(html, en, { ...config, ui: { theme: 'night' } }, ogBytes);
    expect(night).toContain('<html lang="en" data-theme="night">');
  });

  it('escapes quotes in text and fails on an unknown placeholder', () => {
    const quoted = fillPageMeta('<meta content="%lang:x%">', { x: 'a "b" & <c>' }, config, ogBytes);
    expect(quoted).toBe('<meta content="a &quot;b&quot; &amp; &lt;c>">');
    expect(() => fillPageMeta('%site:nope%', en, config, ogBytes)).toThrow(/nope/);
    expect(() => fillPageMeta('%lang:missing.key%', en, config, ogBytes)).toThrow(/missing\.key/);
  });
});
