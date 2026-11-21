import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Banner } from './Banner';
import { ErrorBoundary, PageCrash } from './ErrorBoundary';
import { browserReload, reloadOnce } from './errors/reload-once';
import './fonts/fonts.css';
import './themes/index';
import './styles.css';
import './flows.css';
import './land/land.css';
import './out/out.css';
import './in/in.css';
import './errors/errors.css';
// Last: the finish over the sheets above.
import './look.css';

const banner = document.getElementById('banner');
// /slides is the event deck alone, full screen: no banner, and its code loads only on that page.
const slidesPage = location.pathname === '/slides';
const SlidesPage = lazy(() => import('./slides/SlidesPage').then((m) => ({ default: m.SlidesPage })));
const root = document.getElementById('root');
// Vite reports a script it could not preload (a tab left open across a deploy): one fresh page, then the error card.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnce(browserReload())) event.preventDefault();
});
if (banner && !slidesPage) createRoot(banner).render(<StrictMode><ErrorBoundary fallback={null}><Banner /></ErrorBoundary></StrictMode>);
if (root) createRoot(root).render(<StrictMode><ErrorBoundary fallback={<PageCrash />}>{slidesPage ? <Suspense fallback={null}><SlidesPage /></Suspense> : <App />}</ErrorBoundary></StrictMode>);
