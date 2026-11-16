// The status line under the page ("Cauldron ok · Bitcoin Cash ok · THORChain ok") from GET /api/health, and whether
// the cross-chain tabs show "Paused by the route". The route is listed only while the server checks it (crossings on).

export interface HealthReport {
  checkedAt: number | null;
  cauldron: boolean | null;
  bch: boolean | null;
  height: number | null;
  route: { id: string; open: boolean | null } | null;
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
  const parts = [part('cauldron', t('health.cauldron'), h.cauldron ? 'ok' : 'down'), part('bch', t('health.bch'), h.bch ? 'ok' : 'down')];
  if (h.route) parts.push(part('route', routeName(h.route.id), h.route.open === null ? 'down' : h.route.open ? 'ok' : 'halted'));
  return parts;
}

/** True only when the server's last check saw the route halted. */
export const routeHalted = (h: HealthReport | null): boolean => h?.route?.open === false;
