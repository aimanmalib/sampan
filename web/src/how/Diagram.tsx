import { Fragment } from 'react';

// One flow drawn as boxes joined by arrows, left to right. Labels are page text, so the picture follows the language;
// on narrow screens the row turns into a column and the arrows point down (how.css).
export interface Step {
  label: string;
  /** Second line under the box, smaller. */
  note?: string;
  tone?: 'contract' | 'plain';
}

export function Diagram({ label, steps }: { label: string; steps: Step[] }) {
  return (
    <ol className="diagram" aria-label={label}>
      {steps.map((s, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <li className="diagram__arrow" aria-hidden="true">
              →
            </li>
          ) : null}
          <li className={`diagram__step diagram__step--${s.tone ?? 'plain'}`}>
            <span className="diagram__label">{s.label}</span>
            {s.note ? <span className="diagram__note">{s.note}</span> : null}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
