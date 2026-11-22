// The three pitch lines at the top of README.md and README.ms.md (K6P4): pitch.what / pitch.why / pitch.proof from
// lang/<code>.json, filled the way the deck's slide 1 fills them (core/pitch.ts): the assets are config route.symbols and
// the proof numbers are the headline counted from docs/MEASURED.md, never typed.
//   npm run pitch              print the English block
//   npm run pitch -- --write   rewrite the block in both READMEs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Headline } from '../core/client/measured.js';
import { symbolList } from '../core/flows.js';
import { pitchFrom } from '../core/pitch.js';
import { measuredHeadline } from './measured-json.js';

export const START = '<!-- pitch:start (made by scripts/pitch-block.ts from lang and docs/MEASURED.md) -->';
export const END = '<!-- pitch:end -->';
export type Dictionary = Record<string, string | undefined>;
export interface Target { path: string; lang: 'en' | 'ms' }
export const TARGETS: ReadonlyArray<Target> = [
  { path: 'README.md', lang: 'en' },
  { path: 'README.ms.md', lang: 'ms' },
];

export const repoFile = (p: string): string => fileURLToPath(new URL(`../${p}`, import.meta.url));
export const textOf = (lang: string): Dictionary => JSON.parse(readFileSync(repoFile(`lang/${lang}.json`), 'utf8')) as Dictionary;

/** The block: the first line bold, each line ended with a Markdown hard break except the last. */
export function pitchBlock(text: Dictionary, h: Headline, symbols: string[]): string {
  const p = pitchFrom(text, h, symbolList(symbols, text['text.and'] ?? 'and'));
  return [START, `**${p.what}**\\`, `${p.why}\\`, p.proof, END].join('\n');
}

function bounds(text: string): [number, number] {
  const a = text.indexOf(START);
  const z = text.indexOf(END);
  if (a < 0 || z < a) throw new Error('pitch markers missing');
  return [a, z + END.length];
}

/** `text` with its pitch block replaced by `block`. */
export function replaceBlock(text: string, block: string): string {
  const [a, z] = bounds(text);
  return text.slice(0, a) + block + text.slice(z);
}

/** The pitch block a README holds now. */
export function currentBlock(text: string): string {
  const [a, z] = bounds(text);
  return text.slice(a, z);
}

export function routeSymbols(): string[] {
  const cfg = JSON.parse(readFileSync(repoFile('config/sampan.json'), 'utf8')) as { route: { symbols: string[] } };
  return cfg.route.symbols;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const h = measuredHeadline();
  const symbols = routeSymbols();
  if (process.argv.includes('--write')) {
    for (const t of TARGETS) {
      const f = repoFile(t.path);
      writeFileSync(f, replaceBlock(readFileSync(f, 'utf8'), pitchBlock(textOf(t.lang), h, symbols)));
    }
  } else process.stdout.write(`${pitchBlock(textOf('en'), h, symbols)}\n`);
}
