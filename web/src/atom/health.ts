// Checks before the atomic swap route is offered (the service's own integration note, "Things to check"): the service
// answers on GET {apiPath}/health with ok, mainnet, the chain id the client was built for, and the same AtomLock
// contract as both the client file and Sampan's config. Any failure leaves the route out (no dead button), logs one
// short code with console.info, and the THORChain route works as before.
import type { PublicConfig } from '../../../core/config.js';
import type { AtomClientModule, AtomHealthView, AtomShippedConfig } from './client.js';
import { loadAtomClient, type AtomImporter } from './load.js';

export type AtomHiddenCode = 'off' | 'client-load' | 'client-config' | 'health-timeout' | 'health-error' | 'not-ok' | 'not-mainnet' | 'chain-id' | 'atom-lock';

export type AtomRouteCheck =
  | { show: true; client: AtomClientModule; shipped: AtomShippedConfig; health: AtomHealthView }
  | { show: false; code: AtomHiddenCode };

export interface AtomCheckDeps {
  importer?: AtomImporter;
  log?: (message: string) => void;
}

const TIMEOUT = Symbol('timeout');

function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** Compares the health answer with the client's shipped config and Sampan's config; null when all agree. */
export function healthProblem(health: AtomHealthView, shipped: AtomShippedConfig, configLock: string): AtomHiddenCode | null {
  if (health.ok !== true) return 'not-ok';
  if (health.mainnet !== true) return 'not-mainnet';
  if (health.chainId !== shipped.evm.chainId) return 'chain-id';
  const lock = String(health.atomLock).toLowerCase();
  if (lock !== shipped.evm.atomLock.toLowerCase() || lock !== configLock.toLowerCase()) return 'atom-lock';
  return null;
}

export async function checkAtomRoute(config: Pick<PublicConfig, 'features' | 'atom'>, deps: AtomCheckDeps = {}): Promise<AtomRouteCheck> {
  const log = deps.log ?? ((message: string) => console.info(message));
  const hide = (code: AtomHiddenCode): AtomRouteCheck => {
    if (code !== 'off') log(`atom route hidden: ${code}`);
    return { show: false, code };
  };
  const pending = loadAtomClient(config, deps.importer);
  if (!pending) return hide('off');
  let client: AtomClientModule;
  let shipped: AtomShippedConfig;
  try {
    client = await pending;
  } catch {
    return hide('client-load');
  }
  try {
    shipped = client.shippedConfig();
  } catch {
    return hide('client-config');
  }
  let health: AtomHealthView | typeof TIMEOUT;
  try {
    health = await within(client.makerApi(config.atom.apiPath).health(), config.atom.healthTimeoutMs);
  } catch {
    return hide('health-error');
  }
  if (health === TIMEOUT) return hide('health-timeout');
  const problem = healthProblem(health, shipped, config.atom.atomLock);
  return problem ? hide(problem) : { show: true, client, shipped, health };
}
