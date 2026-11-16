// The business model tables, made from `business` and `pay` in config/sampan.json and nothing else: the sourced
// numbers (each with the URL and the day it was read), the swap scenario (source value x share x scenarioBps) and the
// Sampan Pay scenario (the same source x share x pay.scenarioSpreadBps) with public gateway prices beside it.
// Scenarios are arithmetic, not a forecast. README.md holds each output between two markers; regenerate them with
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
export const PAY_START = '<!-- pay-model:start (made by scripts/business-model.ts from config/sampan.json) -->';
export const PAY_END = '<!-- pay-model:end -->';

/** The two pay settings the Sampan Pay table reads. */
export interface PaySpread {
  spreadBps: number;
  scenarioSpreadBps: number;
}

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

/** Spread per day and per year if Sampan Pay carried `share` of the scenario source, at pay.scenarioSpreadBps. */
export function payRows(b: BusinessConfig, pay: PaySpread): { source: BusinessSource; rows: ScenarioRow[] } {
  const { source } = scenarioRows(b);
  if (!Number.isInteger(pay.scenarioSpreadBps) || pay.scenarioSpreadBps < 1) throw new Error('pay.scenarioSpreadBps: integer above 0');
  if (!b.payPrices?.length) throw new Error('business.payPrices: at least 1 public gateway price');
  const rows = b.scenarioShares.map((share) => {
    const perDayUsd = (source.value as number) * share * (pay.scenarioSpreadBps / 10_000);
    return { share, perDayUsd, perYearUsd: perDayUsd * 365 };
  });
  return { source, rows };
}

/** The markdown block the README's Sampan Pay section carries between PAY_START and PAY_END. */
export function payModel(b: BusinessConfig, pay: PaySpread): string {
  const { source, rows } = payRows(b, pay);
  const bps = pay.scenarioSpreadBps;
  return [
    PAY_START,
    `Scenario, arithmetic, not a forecast. Base: ${source.label} (${value(source)}, read ${source.read}) x share x a ${bps} bps spread. The spread today is ${pay.spreadBps} bps.`,
    '',
    `| Share of that volume paid through Sampan Pay | Spread per day at ${bps} bps | Spread per year (365 days) |`,
    '| --- | --- | --- |',
    ...rows.map((r) => `| ${percent(r.share)} | ${usd(r.perDayUsd)} | ${usd(r.perYearUsd)} |`),
    '',
    '| Public price of a crypto payment gateway | Value | Read on | Source |',
    '| --- | --- | --- | --- |',
    ...b.payPrices!.map((s) => `| ${s.label} | ${value(s)} | ${s.read} | ${s.url} |`),
    PAY_END,
  ].join('\n');
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
export function replaceBlock(readme: string, block: string, start = START, end = END): string {
  const a = readme.indexOf(start);
  const z = readme.indexOf(end);
  if (a < 0 || z < a) throw new Error(`README.md: ${start.slice(5, start.indexOf(':'))} markers missing`);
  return readme.slice(0, a) + block + readme.slice(z + end.length);
}

export function loadBusiness(file: string = CONFIG_FILE): BusinessConfig {
  return (JSON.parse(readFileSync(file, 'utf8')) as { business: BusinessConfig }).business;
}

export function loadPaySpread(file: string = CONFIG_FILE): PaySpread {
  const { spreadBps, scenarioSpreadBps } = (JSON.parse(readFileSync(file, 'utf8')) as { pay: PaySpread }).pay;
  return { spreadBps, scenarioSpreadBps };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const block = businessModel(loadBusiness());
  const pay = payModel(loadBusiness(), loadPaySpread());
  if (process.argv.includes('--write')) {
    const readme = replaceBlock(readFileSync(README_FILE, 'utf8'), block);
    writeFileSync(README_FILE, replaceBlock(readme, pay, PAY_START, PAY_END));
  } else process.stdout.write(`${block}\n\n${pay}\n`);
}
