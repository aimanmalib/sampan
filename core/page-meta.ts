// Fills the %…% placeholders in web/index.html at build time, so the static HTML (what link previews read)
// carries the same text as the app and the preview picture comes from config/sampan.json.
import { descriptionKey, openFlows, symbolList, type FlowFlags } from './flows.js';

export interface PageMetaConfig extends FlowFlags {
  site: { url: string; ogImage: string };
}

export interface PngSize {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from the IHDR chunk of a PNG file. */
export function pngSize(bytes: Uint8Array): PngSize {
  const isPng = bytes.length >= 24 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
  if (!isPng) throw new Error('not a PNG file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** FNV-1a over the bytes: a short cache key, not a security hash. Pure so core/ stays usable in the browser. */
function contentVersion(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * Replaces %lang:key%, %flows:description% and %site:…% in `html`.
 * `ogImageBytes` is the file named by `config.site.ogImage`; its size and a content hash go into the tags,
 * so a new picture gets a new URL past any cache.
 */
export function fillPageMeta(
  html: string,
  en: Record<string, string>,
  config: PageMetaConfig,
  ogImageBytes: Uint8Array,
): string {
  const vars: Record<string, string> = { symbols: symbolList(config.route.symbols, en['text.and'] ?? 'and') };
  const text = (key: string): string => {
    const value = en[key];
    if (value === undefined) throw new Error(`index.html uses missing lang key ${key}`);
    return escapeAttr(value.replace(/\{(\w+)\}/g, (m, name: string) => vars[name] ?? m));
  };
  const { width, height } = pngSize(ogImageBytes);
  const version = contentVersion(ogImageBytes);
  const site: Record<string, string> = {
    url: `${config.site.url}/`,
    image: `${config.site.url}${config.site.ogImage}?v=${version}`,
    'image-width': String(width),
    'image-height': String(height),
  };
  const out = html
    .replace(/%flows:description%/g, () => text(descriptionKey(openFlows(config))))
    .replace(/%lang:([\w.-]+)%/g, (_m, key: string) => text(key))
    .replace(/%site:([\w-]+)%/g, (_m, name: string) => {
      const value = site[name];
      if (value === undefined) throw new Error(`index.html uses unknown %site:${name}%`);
      return escapeAttr(value);
    });
  const left = /%(lang|flows|site):[\w.-]+%/.exec(out);
  if (left) throw new Error(`index.html placeholder not filled: ${left[0]}`);
  return out;
}
