import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('./web', import.meta.url));
const en = JSON.parse(readFileSync(new URL('./lang/en.json', import.meta.url), 'utf8')) as Record<string, string>;

/** Fills %lang:key% placeholders in index.html from lang/en.json so the static HTML carries the same text as the app. */
function htmlText(): Plugin {
  return {
    name: 'sampan-html-text',
    transformIndexHtml(html) {
      return html.replace(/%lang:([\w.-]+)%/g, (_m, key: string) => {
        const value = en[key];
        if (value === undefined) throw new Error(`index.html uses missing lang key ${key}`);
        return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      });
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
