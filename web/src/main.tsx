import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Banner } from './Banner';
import './styles.css';
import './flows.css';
import './land/land.css';
import './out/out.css';
import './in/in.css';

const banner = document.getElementById('banner');
const root = document.getElementById('root');
if (banner) createRoot(banner).render(<StrictMode><Banner /></StrictMode>);
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
