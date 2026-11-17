// The status line under the page ("Cauldron ok · Bitcoin Cash ok · THORChain ok") from GET /api/health, and whether
// the cross-chain tabs show "Paused by the route". The route is listed only while the server checks it (crossings on).

export interface HealthReport {
  checkedAt: number | null;
  cauldron: boolean | null;
  bch: boolean | null;
  height: number | null;
  /** `chains`: open state per chain key from the route's last check (null while unknown). */
  route: { id: string; open: boolean | null; chains?: Record<string, boolean> | null } | null;
}

export type HealthKey = 'health.cauldron' | 'health.bch' | 'health.ok' | 'health.down' | 'health.halted';
export type HealthState = 'ok' | 'down' | 'halted';

export interface HealthPart {
  /** Stable id for styling and tests. */
  id: 'cauldron' | 'bch' | 'route';
  /** Display name: from a text key, or the route's own name passed in. */
  name: string;
  state: HealthState;
  text: string;
}

const STATE_KEY: Record<HealthState, HealthKey> = { ok: 'health.ok', down: 'health.down', halted: 'health.halted' };

/** Parts in page order; empty before the server's first check. */
export function healthParts(h: HealthReport | null, t: (key: HealthKey) => string, routeName: (id: string) => string): HealthPart[] {
  if (!h || h.checkedAt === null) return [];
  const part = (id: HealthPart['id'], name: string, state: HealthState): HealthPart => ({ id, name, state, text: `${name} ${t(STATE_KEY[state])}` });
  // Cauldron unknown after a check = the Bitcoin Cash servers are down and the pools could not be checked: only
  // Bitcoin Cash is named then, so the page does not blame a provider that may be answering.
  const parts = h.cauldron === null ? [] : [part('cauldron', t('health.cauldron'), h.cauldron ? 'ok' : 'down')];
  parts.push(part('bch', t('health.bch'), h.bch ? 'ok' : 'down'));
  if (h.route) parts.push(part('route', routeName(h.route.id), h.route.open === null ? 'down' : h.route.open ? 'ok' : 'halted'));
  return parts;
}

/** True only when the server's last check saw the route halted. */
export const routeHalted = (h: HealthReport | null): boolean => h?.route?.open === false;
