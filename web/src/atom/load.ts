// Loads the atomic swap client file named in config, once, and only while features.atom is true: with the flag off
// the page makes no request for the client or for the service API.
import type { PublicConfig } from '../../../core/config.js';
import type { AtomClientModule } from './client.js';

export type AtomImporter = (url: string) => Promise<unknown>;

const browserImport: AtomImporter = (url) => import(/* @vite-ignore */ url);
const loaded = new Map<string, Promise<AtomClientModule>>();

/** The client module, or null when the route is switched off. A failed load is not cached, so a later visit retries. */
export function loadAtomClient(config: Pick<PublicConfig, 'features' | 'atom'>, importer: AtomImporter = browserImport): Promise<AtomClientModule> | null {
  if (!config.features.atom) return null;
  const url = config.atom.clientUrl;
  let pending = loaded.get(url);
  if (!pending) {
    pending = importer(url).then((m) => m as AtomClientModule);
    pending.catch(() => loaded.delete(url));
    loaded.set(url, pending);
  }
  return pending;
}
