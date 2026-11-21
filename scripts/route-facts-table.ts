// The route facts block in README.md and README.ms.md (K6P5): every live route of docs/route-facts.json with its
// measured time, counted signatures and quoted fee at USD 2, 20 and 100, in the words of lang/<code>.json (the same
// keys and formatting as the hero card line and the /how table, core/route-facts-text.ts). Chain names from config.
//   npm run route-facts              print the English block
//   npm run route-facts -- --write   rewrite the block in both files
// tests/route-facts-render.test.ts fails when a file and the generator disagree. docs/route-facts.json itself is
// measured by tools/measure/route-facts.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FEE_AMOUNTS, type RouteFacts } from '../core/route-facts.js';
import { feeCell, quotedAt, routeName, signaturesText, timeCell, utc, type Text } from '../core/route-facts-text.js';

export const START = '<!-- route-facts:start (made by scripts/route-facts-table.ts from docs/route-facts.json) -->';
export const END = '<!-- route-facts:end -->';
export const FACTS_FILE = 'docs/route-facts.json';

export interface Target { path: string; lang: string }
export const TARGETS: ReadonlyArray<Target> = [
  { path: 'README.md', lang: 'en' },
  { path: 'README.ms.md', lang: 'ms' },
];

export interface ChainsConfig { evm: { chains: ReadonlyArray<{ key: string; name: string }> } }
export type Dictionary = Record<string, string>;

export const repoFile = (p: string): string => fileURLToPath(new URL(`../${p}`, import.meta.url));

/** `t` over one lang file, English for a missing key, as the page's translate() does. */
export function textOf(dict: Dictionary, en: Dictionary): Text {
  return (key, vars = {}) => {
    const text = dict[key] ?? en[key];
    if (text === undefined) throw new Error(`lang key missing: ${key}`);
    return text.replace(/\{(\w+)\}/g, (_m, name: string) => vars[name] ?? `{${name}}`);
  };
}

const cell = (s: string): string => s.replace(/\|/g, '\\|');

export function factsBlock(facts: RouteFacts, cfg: ChainsConfig, t: Text): string {
  const chainName = (key: string): string => cfg.evm.chains.find((c) => c.key === key)?.name ?? key;
  const at = quotedAt(facts);
  const cols = [t('facts.col.route'), t('facts.col.time'), t('facts.col.signatures'), ...FEE_AMOUNTS.map((a) => t('facts.col.fee', { at: `$${a}` }))];
  const rows = facts.routes.map((f) =>
    [routeName(f, t, chainName), timeCell(f, t), signaturesText(f, t), ...FEE_AMOUNTS.map((a) => feeCell(f.fees[a], t))].map(cell),
  );
  return [
    START,
    `**${t('facts.title')}**`,
    '',
    ...(at ? [t('facts.lead', { at: utc(at) }), ''] : []),
    `| ${cols.join(' | ')} |`,
    `|${cols.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
    t('facts.easier'),
    END,
  ].join('\n');
}

function bounds(text: string): [number, number] {
  const a = text.indexOf(START);
  const z = text.indexOf(END);
  if (a < 0 || z < a) throw new Error('route-facts markers missing');
  return [a, z + END.length];
}

/** `text` with its route facts block replaced by `block`. */
export function replaceBlock(text: string, block: string): string {
  const [a, z] = bounds(text);
  return `${text.slice(0, a)}${block}${text.slice(z)}`;
}

/** The block currently in `text`, markers included. */
export function currentBlock(text: string): string {
  const [a, z] = bounds(text);
  return text.slice(a, z);
}

const json = <T>(p: string): T => JSON.parse(readFileSync(repoFile(p), 'utf8')) as T;

export function load(): { facts: RouteFacts; cfg: ChainsConfig; text: (lang: string) => Text } {
  const en = json<Dictionary>('lang/en.json');
  return {
    facts: json<RouteFacts>(FACTS_FILE),
    cfg: json<ChainsConfig>('config/sampan.json'),
    text: (lang) => textOf(json<Dictionary>(`lang/${lang}.json`), en),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { facts, cfg, text } = load();
  if (process.argv.includes('--write')) {
    for (const target of TARGETS) {
      const f = repoFile(target.path);
      writeFileSync(f, replaceBlock(readFileSync(f, 'utf8'), factsBlock(facts, cfg, text(target.lang))));
    }
  } else process.stdout.write(`${factsBlock(facts, cfg, text('en'))}\n`);
}
