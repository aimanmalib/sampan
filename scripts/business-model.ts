// The business model tables, made from `business` in config/sampan.json and nothing else: the sourced numbers
// (each with the URL and the day it was read) and the scenario table (source value x share x scenarioBps).
// The scenario is arithmetic, not a forecast. README.md holds the output between two markers; regenerate it with
//   npx tsx scripts/business-model.ts            print the block
//   npx tsx scripts/business-model.ts --write    rewrite the block in README.md
// tests/business-model.test.ts fails when README.md and config/sampan.json disagree.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateBusiness, type BusinessConfig, type BusinessSource } from '../core/business.js';

export const README_FILE = fileURLToPath(new URL('../README.md', import.meta.url));
const CONFIG_FILE = fileURLToPath(new URL('../config/sampan.json', import.meta.url));
export const START = '<!-- business-model:start (made by scripts/business-model.ts from config/sampan.json) -->';
export const END = '<!-- business-model:end -->';

const usd = (n: number): string => `USD ${Math.round(n).toLocaleString('en-US')}`;
const percent = (share: number): string => `${Number((share * 100).toFixed(2))} %`;

function value(s: BusinessSource): string {
  return typeof s.value === 'number' && s.unit.startsWith('USD') ? `${usd(s.value)}${s.unit.slice(3)}` : `${s.value} ${s.unit}`;
}

export interface ScenarioRow {
  share: number;
  perDayUsd: number;
  perYearUsd: number;
}

/** Fee per day and per year if Sampan carried `share` of the scenario source, at `scenarioBps`. */
export function scenarioRows(b: BusinessConfig): { source: BusinessSource; rows: ScenarioRow[] } {
  const errors = validateBusiness(b);
  if (errors.length) throw new Error(errors.join('; '));
  if (b.sources.length < 2) throw new Error('business.sources: at least 2 sourced numbers');
  const source = b.sources.find((s) => s.scenario);
  if (!source || typeof source.value !== 'number') throw new Error('business.sources: one source must be marked scenario');
  const rows = b.scenarioShares.map((share) => {
    const perDayUsd = (source.value as number) * share * (b.scenarioBps / 10_000);
    return { share, perDayUsd, perYearUsd: perDayUsd * 365 };
  });
  return { source, rows };
}

/** The markdown block README.md carries between START and END. */
export function businessModel(b: BusinessConfig): string {
  const { source, rows } = scenarioRows(b);
  return [
    START,
    '| Number | Value | Read on | Source |',
    '| --- | --- | --- | --- |',
    ...b.sources.map((s) => `| ${s.label} | ${value(s)} | ${s.read} | ${s.url} |`),
    '',
    `Scenario, arithmetic, not a forecast. Base: ${source.label} (${value(source)}, read ${source.read}) x share x a ${b.scenarioBps} bps fee. The Sampan fee today is ${b.feeBps} bps.`,
    '',
    `| Share of that volume through Sampan | Fee per day at ${b.scenarioBps} bps | Fee per year (365 days) |`,
    '| --- | --- | --- |',
    ...rows.map((r) => `| ${percent(r.share)} | ${usd(r.perDayUsd)} | ${usd(r.perYearUsd)} |`),
    END,
  ].join('\n');
}

/** `readme` with the block between the markers replaced by `block`. Throws when the markers are missing. */
export function replaceBlock(readme: string, block: string): string {
  const a = readme.indexOf(START);
  const z = readme.indexOf(END);
  if (a < 0 || z < a) throw new Error('README.md: business-model markers missing');
  return readme.slice(0, a) + block + readme.slice(z + END.length);
}

export function loadBusiness(file: string = CONFIG_FILE): BusinessConfig {
  return (JSON.parse(readFileSync(file, 'utf8')) as { business: BusinessConfig }).business;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const block = businessModel(loadBusiness());
  if (process.argv.includes('--write')) writeFileSync(README_FILE, replaceBlock(readFileSync(README_FILE, 'utf8'), block));
  else process.stdout.write(`${block}\n`);
}
