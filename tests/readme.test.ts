import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (file: string): string => readFileSync(new URL(file, root), 'utf8');

/** Local targets of Markdown links, Markdown images and HTML src/href, without anchors or query strings. */
function localTargets(markdown: string): string[] {
  const found = [
    ...[...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...markdown.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]),
  ];
  return found
    .filter((t): t is string => Boolean(t) && !/^(?:[a-z]+:|#)/i.test(t ?? ''))
    .map((t) => t.split(/[#?]/)[0] ?? '')
    .filter(Boolean);
}

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

  it('the English and Malay READMEs link to each other near the top', () => {
    const head = (file: string) => read(file).split('\n').slice(0, 30).join('\n');
    expect(head('README.md')).toContain('README.ms.md');
    expect(head('README.ms.md')).toContain('README.md');
  });

  it.each(['README.md', 'README.ms.md'])('every local link and image in %s exists, and images use relative paths', (file) => {
    const text = read(file);
    const targets = localTargets(text);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(existsSync(new URL(target, root)), target).toBe(true);
    expect(text).not.toMatch(/raw\.githubusercontent\.com/);
  });
});
