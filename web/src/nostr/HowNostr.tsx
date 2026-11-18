// /how#nostr, drawn only while features.nostrSend is on: how a Nostr identity is checked before it can be paid,
// which relays this page asks (from config), that no identity server is involved, and what a relay can still do.
import type { LoadedConfig } from '../config';
import { useText, type TextKey } from '../i18n';

const STEPS: TextKey[] = ['how.nostr.s1', 'how.nostr.s2', 'how.nostr.s3', 'how.nostr.s4', 'how.nostr.s5'];

export function HowNostr({ config }: { config: LoadedConfig }) {
  const { t } = useText();
  const nostrId = config.features.nostrSend ? config.nostrId : null;
  if (!nostrId) return null;
  return (
    <section id="nostr">
      <h2>{t('how.nostr.title')}</h2>
      <p>{t('how.nostr.text')}</p>
      <ol>
        {STEPS.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
      <p>{t('how.nostr.relays')}</p>
      <ul className="how__relays">
        {nostrId.relays.map((relay) => (
          <li key={relay} className="mono">
            {relay}
          </li>
        ))}
      </ul>
      <p>{t('how.nostr.server')}</p>
      <p>{t('how.nostr.limit')}</p>
    </section>
  );
}
