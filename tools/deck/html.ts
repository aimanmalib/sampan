// Lays the deck slides out as one HTML page, one 1280 x 720 section per slide, for Chromium to print to PDF.
// Colours and fonts come only from the shipped theme's tokens (web/src/themes/<theme>.css) and the self-hosted
// fonts (web/src/fonts), passed in as text and data URLs, so the page loads nothing from the network.
import type { Slide } from './content.js';

export interface DeckAssets {
  /** The theme file's CSS, e.g. web/src/themes/paper.css. */
  themeCss: string;
  /** Theme name for <html data-theme>. */
  theme: string;
  /** @font-face rules with data: URLs. */
  fontCss: string;
  /** Logo SVG markup. */
  logoSvg: string;
}

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Turns bare URLs into links so the PDF keeps them clickable. */
function linkify(s: string): string {
  return escape(s).replace(/https:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
}

const LAYOUT = `
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: var(--font-text); color: var(--ink); background: var(--paper); }
a { color: var(--river); text-decoration: none; }
.slide { width: 1280px; height: 720px; padding: 64px 80px 56px; display: flex; flex-direction: column;
  position: relative; overflow: hidden; page-break-after: always; break-after: page; background: var(--paper); }
.slide:last-child { page-break-after: auto; break-after: auto; }
.slide__mark { position: absolute; top: 40px; right: 64px; width: 48px; height: 48px; }
.slide__mark svg { width: 100%; height: 100%; }
.slide__n { position: absolute; bottom: 28px; right: 64px; font: 500 14px var(--font-mono); color: var(--ink-soft); }
h1 { font-family: var(--font-display); font-weight: 600; font-size: 52px; line-height: 1.1; margin: 0 0 20px; color: var(--ink); }
.lead { font-family: var(--font-display); font-size: 28px; line-height: 1.3; margin: 0 0 28px; color: var(--river); max-width: 940px; }
.body { display: flex; gap: 40px; flex: 1; min-height: 0; }
ul { margin: 0; padding: 0; list-style: none; flex: 1; display: flex; flex-direction: column; gap: 14px; }
li { font-size: 21px; line-height: 1.4; padding-left: 28px; position: relative; }
li::before { content: ''; position: absolute; left: 0; top: 11px; width: 12px; height: 4px; border-radius: 2px; background: var(--lamp); }
.foot { margin-top: 20px; font: 14px/1.5 var(--font-mono); color: var(--ink-soft); }
.foot p { margin: 0; overflow-wrap: anywhere; }
.slide--cover { background: var(--ink); color: var(--paper); justify-content: center; }
.slide--cover h1 { font-size: 104px; color: var(--paper); }
.slide--cover .lead { color: var(--river-pale); font-size: 34px; }
.slide--cover li { font-size: 22px; color: var(--paper); overflow-wrap: anywhere; }
.slide--cover a { color: var(--river-pale); }
.slide--cover .foot, .slide--cover .slide__n { color: var(--paper-deep); }
.slide--cover .bar { width: 120px; height: 6px; border-radius: 3px; background: var(--lamp); margin-bottom: 36px; }
`;

function slideHtml(s: Slide, i: number, total: number, a: DeckAssets): string {
  const parts: string[] = [];
  if (s.cover) parts.push('<div class="bar"></div>');
  parts.push(`<h1>${escape(s.title)}</h1>`);
  if (s.lead) parts.push(`<p class="lead">${linkify(s.lead)}</p>`);
  const list = s.points?.length ? `<ul>${s.points.map((p) => `<li>${linkify(p)}</li>`).join('')}</ul>` : '';
  if (list) parts.push(`<div class="body">${list}</div>`);
  if (s.foot?.length) parts.push(`<div class="foot">${s.foot.map((f) => `<p>${linkify(f)}</p>`).join('')}</div>`);
  const mark = s.cover ? '' : `<div class="slide__mark" aria-hidden="true">${a.logoSvg}</div>`;
  return `<section class="slide${s.cover ? ' slide--cover' : ''}">${mark}${parts.join('')}<div class="slide__n">${i + 1} / ${total}</div></section>`;
}

export function deckHtml(list: Slide[], a: DeckAssets): string {
  return `<!doctype html><html lang="en" data-theme="${escape(a.theme)}"><head><meta charset="utf-8"><title>Sampan</title>
<style>${a.fontCss}
${a.themeCss}
${LAYOUT}</style></head><body>${list.map((s, i) => slideHtml(s, i, list.length, a)).join('\n')}</body></html>`;
}
