// One flow drawn as a crossing: a mooring on each bank and, in midstream, what stands between them (the contract, the
// pools or the routes). Labels are page text, so the picture follows the language; on a narrow screen the crossing
// runs top to bottom (story.css). The legs between the moorings are drawn in CSS and say nothing to a screen reader.
import type { ReactNode } from 'react';

export interface Mooring {
  text: string;
  /** Decoration beside the text (a chain or token icon). */
  icon?: ReactNode;
}

function Stop({ items, tone, note }: { items: Mooring[]; tone: 'bank' | 'mid'; note?: string | undefined }) {
  return (
    <li className={`wake__stop wake__stop--${tone}`}>
      {items.map((m) => (
        <span key={m.text} className="wake__name">
          {m.icon}
          {m.text}
        </span>
      ))}
      {note ? <span className="wake__note">{note}</span> : null}
    </li>
  );
}

export function Crossing({
  label,
  from,
  via,
  to,
  note,
  bothWays = false,
}: {
  label: string;
  from: Mooring[];
  via: Mooring[];
  to: Mooring[];
  /** A second, smaller line under the far bank (what happens otherwise). */
  note?: string;
  /** The crossing runs in both directions (between chains): the legs carry no arrowhead. */
  bothWays?: boolean;
}) {
  const leg = <li className={bothWays ? 'wake__leg wake__leg--both' : 'wake__leg'} aria-hidden="true" />;
  return (
    <ol className="wake" aria-label={label}>
      <Stop items={from} tone="bank" />
      {leg}
      <Stop items={via} tone="mid" />
      {leg}
      <Stop items={to} tone="bank" note={note} />
    </ol>
  );
}
