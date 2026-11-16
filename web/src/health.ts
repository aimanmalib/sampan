// GET /api/health, fetched once per page load and shared by the status line and the cross-chain tabs.
import { useEffect, useState } from 'react';
import type { HealthReport } from '../../core/client/health';
import { api } from './api';

let pending: Promise<HealthReport> | null = null;

/** The server's last health check; null while loading or when it cannot be read. */
export function useHealth(): HealthReport | null {
  const [health, setHealth] = useState<HealthReport | null>(null);
  useEffect(() => {
    let live = true;
    pending ??= api.get<HealthReport>('/api/health');
    pending.then((h) => live && setHealth(h)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return health;
}
