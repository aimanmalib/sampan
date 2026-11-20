// The front page's main message, read in under a minute with no video (K6P4): what (the headline), why, and the proof
// counted from docs/MEASURED.md when the page is built (core/pitch.ts). `symbols`: the open assets, joined, as the hero sub
// names them. The proof links to the table of every transaction.
import { headline } from 'virtual:sampan-proof';
import { pitchLines } from '../../core/pitch';
import { useText } from './i18n';

export function HeroPitch({ symbols }: { symbols: string }) {
  const { t } = useText();
  const pitch = pitchLines(headline, t, symbols);
  return (
    <>
      <h1 className="hero__title">{pitch.what}</h1>
      <p className="hero__pitch">
        <span className="hero__why">{pitch.why}</span>{' '}
        <a className="hero__proof" href="/how#proof" data-crossings={headline.crossings}>
          {pitch.proof}
        </a>
      </p>
    </>
  );
}
