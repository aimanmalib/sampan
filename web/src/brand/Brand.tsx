// The Sampan mark and name. The mark is the same drawing as brand/logo.svg and the favicon (a hull and a lit sail on
// the ink ground), drawn inline so its colours follow the theme tokens.
import './brand.css';

export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className="mark__ground" width="32" height="32" rx="7" />
      <path className="mark__hull" d="M5 18h22l-4 6H9z" />
      <path className="mark__sail" d="M16 6v11M16 7l7 9h-7" />
    </svg>
  );
}

/** The mark and the name, linked to the front page. */
export function Brand() {
  return (
    <a className="brand" href="/">
      <Mark />
      <span className="wordmark">Sampan</span>
    </a>
  );
}
