// Sampan Pay's two pages: /pay (merchants and the demo shop) and /pay/i/:id (an invoice). Drawn only when
// features.pay is on (App decides); nothing is drawn while the config is still loading.
import type { LoadedConfig } from '../config';
import { InvoicePage } from './InvoicePage';
import { ShopPage } from './ShopPage';
import './pay.css';

export type PayRoute = { page: 'shop' } | { page: 'invoice'; id: string };

export function payRoute(pathname: string): PayRoute | null {
  if (pathname === '/pay' || pathname === '/pay/') return { page: 'shop' };
  const id = /^\/pay\/i\/([0-9a-f]{32})$/.exec(pathname)?.[1];
  return id ? { page: 'invoice', id } : null;
}

export function PayPages({ route, config }: { route: PayRoute; config: LoadedConfig | null }) {
  if (!config) return null;
  return route.page === 'shop' ? <ShopPage config={config} /> : <InvoicePage id={route.id} config={config} />;
}
