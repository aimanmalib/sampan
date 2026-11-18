// What a recipient field shows under it while it holds a Nostr identity: "Checking", the reason it cannot be paid,
// or the verified card (shortened npub, the full address that will be used, and a link to how it was checked).
// A failed identity shows its reason only: no address from the event is ever shown or offered.
import type { NostrIdConfig } from '../../../core/nostr-config';
import { useText, type TextKey } from '../i18n';
import { shortNpub } from './query';
import type { NostrState } from './useNostrRecipient';
import './nostr.css';

export function NostrCard({ state, nostrId, use }: { state: NostrState; nostrId: NostrIdConfig; use: 'address' | 'tokenAddress' }) {
  const { t } = useText();
  if (state.at === 'idle') return null;
  if (state.at === 'checking') {
    return (
      <p className="nostr__checking card__note" role="status" data-nostr="checking">
        {t('nostr.checking')}
      </p>
    );
  }
  if (state.at === 'fail') {
    return (
      <p className="swap__error" role="alert" data-nostr="failed" data-reason={state.code}>
        {t(`nostr.reason.${state.code}` as TextKey)}
      </p>
    );
  }
  const { result } = state;
  return (
    <div className="nostr" role="status" data-nostr="verified">
      <p className="nostr__title">
        <span aria-hidden="true" className="nostr__tick">✓</span> {t('nostr.verified')}{' '}
        <span className="mono nostr__npub" title={result.npub}>
          {shortNpub(result.npub, nostrId.npubShortChars)}
        </span>
      </p>
      <p className="mono nostr__address">{result[use]}</p>
      <p className="nostr__how">
        <a href="/how#nostr">{t('nostr.howLink')}</a>
      </p>
    </div>
  );
}
