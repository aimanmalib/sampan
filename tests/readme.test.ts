import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('public documents', () => {
  it('README names the event exactly and has an AI disclosure section', () => {
    const readme = read('README.md');
    expect(readme).toContain('BCH BLAZE 2026');
    expect(readme).toMatch(/^## AI disclosure$/m);
  });

  it('the static page carries the event name in the title and the banner', () => {
    const html = read('web/index.html');
    expect(html).toMatch(/<title>[^<]*BCH BLAZE 2026[^<]*<\/title>/);
    expect(html).toMatch(/class="banner__event">BCH BLAZE 2026</);
  });
});
