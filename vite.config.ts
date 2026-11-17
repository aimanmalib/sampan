import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { publicConfig, type SampanConfig } from './core/config.js';
import { fillPageMeta } from './core/page-meta.js';
import { MEASURED_FILE, measuredJson } from './scripts/measured-json.js';

const root = fileURLToPath(new URL('./web', import.meta.url));
const en = JSON.parse(readFileSync(new URL('./lang/en.json', import.meta.url), 'utf8')) as Record<string, string>;
// The public part, as /api/config serves it: texts name the symbols of the live route assets.
const config = publicConfig(JSON.parse(readFileSync(new URL('./config/sampan.json', import.meta.url), 'utf8')) as SampanConfig);

/** Fills the %…% placeholders in index.html (text from lang/en.json, link preview from config/sampan.json). */
function htmlText(): Plugin {
  return {
    name: 'sampan-html-text',
    transformIndexHtml(html) {
      const ogImage = readFileSync(new URL(`./web/public${config.site.ogImage}`, import.meta.url));
      return fillPageMeta(html, en, config, ogImage);
    },
  };
}

/** `virtual:sampan-proof`: the Runs and Wallets checked tables of docs/MEASURED.md, parsed when the page is built. */
function proof(): Plugin {
  const id = 'virtual:sampan-proof';
  return {
    name: 'sampan-proof',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(loaded) {
      if (loaded !== `\0${id}`) return undefined;
      this.addWatchFile(MEASURED_FILE);
      return `export default ${JSON.stringify(measuredJson())};`;
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), htmlText(), proof()],
  // The WalletConnect provider's own modal is never used (Sampan draws the QR code): keep it out of the bundle.
  resolve: { alias: { '@reown/appkit/core': fileURLToPath(new URL('./web/src/evm/no-appkit.ts', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://127.0.0.1:8080', '/healthz': 'http://127.0.0.1:8080' },
  },
});
