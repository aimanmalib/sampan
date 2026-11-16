import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Banner } from './Banner';
import { ErrorBoundary, PageCrash } from './ErrorBoundary';
import { browserReload, reloadOnce } from './errors/reload-once';
import './styles.css';
import './flows.css';
import './land/land.css';
import './out/out.css';
import './in/in.css';
import './errors/errors.css';

const banner = document.getElementById('banner');
const root = document.getElementById('root');
// Vite reports a script it could not preload (a tab left open across a deploy): one fresh page, then the error card.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnce(browserReload())) event.preventDefault();
});
if (banner) createRoot(banner).render(<StrictMode><ErrorBoundary fallback={null}><Banner /></ErrorBoundary></StrictMode>);
if (root) createRoot(root).render(<StrictMode><ErrorBoundary fallback={<PageCrash />}><App /></ErrorBoundary></StrictMode>);
