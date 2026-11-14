import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'server/main': 'server/main.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: false,
});
