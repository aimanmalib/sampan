import { useEffect, useState } from 'react';
import type { PublicConfig } from '../../core/config';

export type LoadedConfig = PublicConfig & { fake: boolean };

let pending: Promise<LoadedConfig> | null = null;

export function fetchConfig(): Promise<LoadedConfig> {
  pending ??= fetch('/api/config', { headers: { accept: 'application/json' } }).then((res) => {
    if (!res.ok) throw new Error(`config ${res.status}`);
    return res.json() as Promise<LoadedConfig>;
  });
  return pending;
}

/** Config from the server; null while loading or if the server cannot be reached. */
export function useConfig(): LoadedConfig | null {
  const [config, setConfig] = useState<LoadedConfig | null>(null);
  useEffect(() => {
    let live = true;
    fetchConfig()
      .then((c) => live && setConfig(c))
      .catch(() => live && setConfig(null));
    return () => {
      live = false;
    };
  }, []);
  return config;
}
