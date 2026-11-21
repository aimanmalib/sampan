// /slides moves (web/src/slides/nav.ts): #n in the address, keys, sideways swipes and the fit of a 1280 x 720 slide.
import { describe, expect, it } from 'vitest';
import { fitScale, hashOf, keyTarget, slideFromHash, swipeStep } from '../web/src/slides/nav.js';

describe('slides navigation', () => {
  it('opens the slide #n names, 1-based, kept inside the deck', () => {
    expect(slideFromHash('#3', 8)).toBe(2);
    expect(slideFromHash('#1', 8)).toBe(0);
    expect(slideFromHash('#99', 8)).toBe(7);
    expect(slideFromHash('#0', 8)).toBe(0);
    expect(slideFromHash('', 8)).toBe(0);
    expect(slideFromHash('#three', 8)).toBe(0);
    expect(hashOf(2)).toBe('#3');
  });
  it('moves one slide per arrow or page key and jumps with Home and End, stopping at both ends', () => {
    expect(keyTarget('ArrowRight', 0, 8)).toBe(1);
    expect(keyTarget(' ', 3, 8)).toBe(4);
    expect(keyTarget('PageDown', 7, 8)).toBe(7);
    expect(keyTarget('ArrowLeft', 0, 8)).toBe(0);
    expect(keyTarget('PageUp', 5, 8)).toBe(4);
    expect(keyTarget('Home', 5, 8)).toBe(0);
    expect(keyTarget('End', 1, 8)).toBe(7);
    expect(keyTarget('x', 4, 8)).toBe(4);
  });
  it('reads a swipe to the left as next and to the right as back, only when long enough and mostly sideways', () => {
    expect(swipeStep(-80, 10, 48)).toBe(1);
    expect(swipeStep(80, -10, 48)).toBe(-1);
    expect(swipeStep(-40, 0, 48)).toBe(0);
    expect(swipeStep(-60, 70, 48)).toBe(0);
    expect(swipeStep(-48, 0, 48)).toBe(1);
  });
  it('fits the slide by its tighter side', () => {
    expect(fitScale(1280, 720, 1280, 720)).toBe(1);
    expect(fitScale(390, 600, 1280, 720)).toBeCloseTo(390 / 1280);
    expect(fitScale(844, 300, 1280, 720)).toBeCloseTo(300 / 720);
    expect(fitScale(0, 300, 1280, 720)).toBe(0);
  });
});
