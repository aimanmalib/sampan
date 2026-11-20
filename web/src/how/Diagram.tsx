import { Fragment } from 'react';

// One flow drawn as boxes joined by arrows, left to right. Labels are page text, so the picture follows the language;
// on narrow screens the row turns into a column and the arrows point down (how.css).
export interface Step {
  /** One label, or several (each its own node in the box, e.g. every route that carries a crossing). */
  label: string | string[];
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
            {(Array.isArray(s.label) ? s.label : [s.label]).map((l) => (
              <span key={l} className="diagram__label" data-node={l}>
                {l}
              </span>
            ))}
            {s.note ? <span className="diagram__note">{s.note}</span> : null}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
