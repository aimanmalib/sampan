// docs/MEASURED.md -> the proof summary JSON the /how page is built with. `vite build` (npm run build) imports it
// through the virtual module `virtual:sampan-proof`; run it directly to see or save the same JSON:
//   npx tsx scripts/measured-json.ts [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProof, type Proof } from '../core/proof.js';

export const MEASURED_FILE = fileURLToPath(new URL('../docs/MEASURED.md', import.meta.url));

export function measuredJson(file: string = MEASURED_FILE): Proof {
  return buildProof(readFileSync(file, 'utf8'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = `${JSON.stringify(measuredJson(), null, 2)}\n`;
  const out = process.argv[2];
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
}
