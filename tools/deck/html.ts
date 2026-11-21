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
  /** tools/deck/deck.css, the slide layout the /slides page uses too. */
  layoutCss: string;
}

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Turns bare URLs into links so the PDF keeps them clickable. */
function linkify(s: string): string {
  return escape(s).replace(/https:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
}

// The page box and margins; the slide layout itself is tools/deck/deck.css, shared with the /slides page.
const PRINT = `
@page { size: 1280px 720px; margin: 0; }
html, body { margin: 0; padding: 0; }
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
${a.layoutCss}
${PRINT}</style></head><body class="deck">${list.map((s, i) => slideHtml(s, i, list.length, a)).join('\n')}</body></html>`;
}
