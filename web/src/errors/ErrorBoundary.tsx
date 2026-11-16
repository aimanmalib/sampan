// Keeps a fault in one part of the page from blanking the rest: the whole app has one boundary and every tab its own,
// so a broken tab leaves the headline, the picture and the other tabs in place. A failed script load reloads once.
import { Component, type ReactNode } from 'react';
import { useText } from '../i18n';
import { browserReload, isChunkError, reloadOnce } from './reload-once';

/** The card shown in place of the part that failed. */
export function ErrorCard() {
  const { t } = useText();
  return (
    <div className="crash" role="alert">
      <p className="crash__title">{t('error.title')}</p>
      <p className="crash__body">{t('error.body')}</p>
      <button type="button" className="button" onClick={() => location.reload()}>
        {t('error.reload')}
      </button>
    </div>
  );
}

/** What the whole page shows when the app itself fails: the headline stays, so the visitor knows where they are. */
export function PageCrash() {
  const { t } = useText();
  return (
    <main className="page">
      <section className="hero">
        <h1 className="hero__title">{t('hero.title')}</h1>
      </section>
      <ErrorCard />
    </main>
  );
}

interface Props {
  children: ReactNode;
  fallback: ReactNode;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  /** React itself reports the error to the console; a script that failed to load gets one fresh page first. */
  override componentDidCatch(error: unknown): void {
    if (isChunkError(error)) reloadOnce(browserReload());
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
