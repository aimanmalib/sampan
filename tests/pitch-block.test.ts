// The pitch block at the top of README.md and README.ms.md (scripts/pitch-block.ts): the lang keys filled with the headline
// counted from docs/MEASURED.md, and each README holding exactly the block the generator makes now.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Headline } from '../core/client/measured.js';
import { currentBlock, END, pitchBlock, replaceBlock, repoFile, routeSymbols, START, TARGETS, textOf } from '../scripts/pitch-block.js';
import { measuredHeadline } from '../scripts/measured-json.js';

const frozen = {
  'pitch.what': 'Coins in and out.',
  'pitch.why': 'Bring {symbols} in.',
  'pitch.whyBch': 'Keep dollars.',
  'pitch.proof': 'Measured: {crossings} crossings, {chains} chains, {txids} transactions.',
  'text.and': 'and',
};
const h: Headline = { crossings: 7, chains: ['ETH', 'BSC'], symbols: ['USDC'], bothWays: ['ETH'], txids: 19 };

describe('pitch block', () => {
  it('fills the three lines from the headline and the route symbols', () => {
    expect(pitchBlock(frozen, h, ['USDC', 'USDT'])).toBe(
      [START, '**Coins in and out.**\\', 'Bring USDC and USDT in.\\', 'Measured: 7 crossings, 2 chains, 19 transactions.', END].join('\n'),
    );
  });

  it('says the BCH half only when no asset is listed', () => {
    expect(pitchBlock(frozen, h, [])).toContain('Keep dollars.\\');
  });

  it('replaces only the block', () => {
    const text = `a\n${START}\nold\n${END}\nb`;
    expect(replaceBlock(text, `${START}\nnew\n${END}`)).toBe(`a\n${START}\nnew\n${END}\nb`);
    expect(() => replaceBlock('no markers', 'x')).toThrow();
  });

  it.each(TARGETS)('$path holds the block made now (npm run pitch -- --write)', (t) => {
    const readme = readFileSync(repoFile(t.path), 'utf8');
    expect(currentBlock(readme)).toBe(pitchBlock(textOf(t.lang), measuredHeadline(), routeSymbols()));
  });
});
