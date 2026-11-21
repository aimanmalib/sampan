// Fingerprint of the slide text the PDF was printed from (tools/deck/printed.sha256), so a stale PDF fails the test.
// Kept apart from content.ts, which the page imports too and so stays free of Node modules.
import { createHash } from 'node:crypto';
import type { Slide } from './content.js';

export const slidesHash = (list: Slide[]): string => createHash('sha256').update(JSON.stringify(list)).digest('hex');
