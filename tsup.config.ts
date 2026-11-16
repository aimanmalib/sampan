import { defineConfig } from 'tsup';
import { proofTxids } from './core/proof.js';
import { measuredJson } from './scripts/measured-json.js';

export default defineConfig({
  entry: { 'server/main': 'server/main.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: false,
  // Keep the node: prefix: node:sqlite has no bare-name alias.
  removeNodeProtocol: false,
  // Transaction ids of the team's own runs in docs/MEASURED.md: rows with these ids never count as other people's.
  define: { __SAMPAN_TEAM_TXIDS__: JSON.stringify(proofTxids(measuredJson())) },
});
