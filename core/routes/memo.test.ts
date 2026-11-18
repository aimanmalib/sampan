import { describe, expect, it } from 'vitest';
import quote from '../../tests/fixtures/thorchain/quote-out.json' with { type: 'json' };
import { limitFor, memoMatches, opReturnHex, parseSwapMemo, thorAsset, withLimit, withoutPrefix } from './memo.js';

const DEST = '0x1a877169bB03400fA69EC4813889E78994D194Cb';
const ASSET = thorAsset('BASE', 'USDC', '0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913');

describe('THORChain memo', () => {
  it('names assets and BCH destinations the way THORChain reads them', () => {
    expect(ASSET).toBe('BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913');
    expect(thorAsset('BCH', 'BCH')).toBe('BCH.BCH');
    expect(withoutPrefix('bitcoincash:qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt')).toBe('qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt');
    expect(withoutPrefix('qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt')).toBe('qqyuz8zh06c8h39guuedjpfvnlvjeg394ucvfe6ltt');
  });

  it('adds our own limit to the memo of a captured quote', () => {
    const limit = limitFor(BigInt(quote.expected_amount_out), 150);
    expect(limit).toBe((184525600n * 9850n) / 10000n);
    const memo = withLimit(quote.memo, limit);
    expect(memo).toBe(`=:BASE.USDC:${DEST}:${limit}`);
    expect(parseSwapMemo(memo)).toEqual({ asset: 'BASE.USDC', destination: DEST, limit });
  });

  it('keeps streaming and affiliate fields and replaces only the limit', () => {
    expect(withLimit('=:BCH.BCH:qq:0/1/0:aff:10', 5n)).toBe('=:BCH.BCH:qq:5/1/0:aff:10');
    expect(withLimit('=:BCH.BCH:qq:99', 5n)).toBe('=:BCH.BCH:qq:5');
  });

  it('refuses memos that are not swaps or would not fit an OP_RETURN', () => {
    expect(() => withLimit('+:BTC.BTC', 1n)).toThrow(/not a swap/);
    expect(() => withLimit(`=:BASE.USDC:0x${'a'.repeat(70)}`, 1n)).toThrow(/80 bytes/);
  });

  it('encodes the memo as one push after OP_RETURN', () => {
    expect(opReturnHex('=:x')).toBe('6a033d3a78');
    const long = opReturnHex('a'.repeat(80));
    expect(long.slice(0, 6)).toBe('6a4c50');
    expect(long.length).toBe(6 + 160);
    expect(() => opReturnHex('a'.repeat(81))).toThrow();
  });

  it('accepts a memo only for the typed address, the expected asset and at least the shown minimum', () => {
    const memo = withLimit(quote.memo, 1000n);
    expect(memoMatches(memo, { asset: ASSET, destination: DEST.toLowerCase(), minOut: 1000n })).toBe(true);
    expect(memoMatches(memo, { asset: ASSET, destination: `0x${'b'.repeat(40)}`, minOut: 1000n })).toMatch(/another address/);
    expect(memoMatches(memo, { asset: 'BASE.ETH', destination: DEST, minOut: 1000n })).toMatch(/another asset/);
    expect(memoMatches(memo, { asset: ASSET, destination: DEST, minOut: 1001n })).toMatch(/limit/);
    expect(memoMatches(quote.memo, { asset: ASSET, destination: DEST, minOut: 0n })).toMatch(/limit/);
  });

  it('reads the short code THORChain quotes for ether (gas funding of the EVM test key)', () => {
    const memo = `=:e:${DEST}:37665/1/0`;
    expect(memoMatches(memo, { asset: 'ETH.ETH', destination: DEST, minOut: 37665n })).toBe(true);
    expect(memoMatches(memo, { asset: 'BASE.ETH', destination: DEST, minOut: 37665n })).toMatch(/another asset/);
  });

  it('reads the short codes THORChain quotes for BNB and AVAX (gas funding on BSC and Avalanche)', () => {
    expect(memoMatches(`=:s:${DEST}:119282/1/0`, { asset: 'BSC.BNB', destination: DEST, minOut: 119282n })).toBe(true);
    expect(memoMatches(`=:a:${DEST}:5000/1/0`, { asset: 'AVAX.AVAX', destination: DEST, minOut: 5000n })).toBe(true);
    expect(memoMatches(`=:s:${DEST}:119282/1/0`, { asset: 'AVAX.AVAX', destination: DEST, minOut: 119282n })).toMatch(/another asset/);
    expect(memoMatches(`=:a:${DEST}:5000/1/0`, { asset: 'BSC.USDC-0X8AC76A51CC950D9822D68B83FE1AD97B32CD580D', destination: DEST, minOut: 5000n })).toMatch(/another asset/);
  });
});
