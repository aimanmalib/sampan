import { describe, expect, it } from 'vitest';
import { withTheme } from '../server/static.js';

describe('withTheme', () => {
  it('names the running config theme on the html element and nowhere else', () => {
    const html = '<!doctype html>\n<html lang="en" data-theme="paper">\n<body><p data-theme="paper"></p></body></html>';
    expect(withTheme(html, 'night')).toBe('<!doctype html>\n<html lang="en" data-theme="night">\n<body><p data-theme="paper"></p></body></html>');
  });
  it('leaves a page without the attribute unchanged', () => {
    expect(withTheme('<html lang="en"><body></body></html>', 'night')).toBe('<html lang="en"><body></body></html>');
  });
});
