import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { descriptionKey, openFlows, symbolList, type FlowFlags } from './core/flows.js';

const root = fileURLToPath(new URL('./web', import.meta.url));
const en = JSON.parse(readFileSync(new URL('./lang/en.json', import.meta.url), 'utf8')) as Record<string, string>;
const config = JSON.parse(readFileSync(new URL('./config/sampan.json', import.meta.url), 'utf8')) as FlowFlags;

/**
 * Fills %lang:key% placeholders in index.html from lang/en.json so the static HTML carries the same text as the app.
 * %flows:description% is the description for the flows switched on in config/sampan.json.
 */
function htmlText(): Plugin {
  const flows = openFlows(config);
  const vars: Record<string, string> = { symbols: symbolList(config.route.symbols, en['text.and'] ?? 'and') };
  const text = (key: string): string => {
    const value = en[key];
    if (value === undefined) throw new Error(`index.html uses missing lang key ${key}`);
    return value
      .replace(/\{(\w+)\}/g, (m, name: string) => vars[name] ?? m)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  };
  return {
    name: 'sampan-html-text',
    transformIndexHtml(html) {
      return html
        .replace(/%flows:description%/g, () => text(descriptionKey(flows)))
        .replace(/%lang:([\w.-]+)%/g, (_m, key: string) => text(key));
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), htmlText()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://127.0.0.1:8080', '/healthz': 'http://127.0.0.1:8080' },
  },
});
