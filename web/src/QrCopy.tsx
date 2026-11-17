// A QR code that is also a button: a click or tap copies the link the code holds and says so in a live region.
// With no clipboard API nothing happens and the page's own copy button is still there.
import { useState, type ReactNode } from 'react';

export function QrCopy(props: { value: string; label: string; done: string; className?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`qrcopy${props.className ? ` ${props.className}` : ''}`}>
      <button
        type="button"
        className="qrcopy__button"
        aria-label={props.label}
        onClick={() => void navigator.clipboard?.writeText(props.value).then(() => setCopied(true), () => setCopied(false))}
      >
        {props.children}
      </button>
      <span className="qrcopy__done" aria-live="polite">
        {copied ? props.done : ''}
      </span>
    </div>
  );
}
