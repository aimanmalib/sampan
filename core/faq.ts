// /faq: which questions are asked and which custody steps are listed, in config (faq.items, faq.custody); the words
// live in lang/ under faq.<item>.q / .a and faq.hold.<key>.title / .text. A custody step marked `cross` is shown only
// while cross-chain flows are open.

export interface FaqCustodyStep {
  key: string;
  cross?: boolean;
}

export interface FaqConfig {
  /** Question keys, in the order the page asks them (at least six). */
  items: string[];
  /** Who holds the funds at each step, in order. */
  custody: FaqCustodyStep[];
}

const KEY = /^[a-z][a-zA-Z]*$/;
export const FAQ_MIN_ITEMS = 6;

const unique = (keys: unknown[]): boolean => new Set(keys).size === keys.length;

export function validateFaq(f: FaqConfig | undefined): string[] {
  const errors: string[] = [];
  const items = f?.items;
  if (!Array.isArray(items) || items.length < FAQ_MIN_ITEMS || !items.every((k) => typeof k === 'string' && KEY.test(k)) || !unique(items)) {
    errors.push(`faq.items: at least ${FAQ_MIN_ITEMS} unique camelCase question keys`);
  }
  const steps = f?.custody;
  if (!Array.isArray(steps) || steps.length === 0 || !steps.every((s) => typeof s?.key === 'string' && KEY.test(s.key)) || !unique(steps.map((s) => s?.key))) {
    errors.push('faq.custody: a list of unique { key } in camelCase');
  } else {
    for (const s of steps) {
      if (s.cross !== undefined && typeof s.cross !== 'boolean') errors.push(`faq.custody ${s.key}: cross is true or false`);
    }
  }
  return errors;
}

/** The custody steps a visitor sees: a `cross` step only while cross-chain flows are open. */
export function shownCustody(f: FaqConfig, crossOpen: boolean): FaqCustodyStep[] {
  return f.custody.filter((s) => !s.cross || crossOpen);
}
