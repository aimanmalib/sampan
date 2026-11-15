// Turns a failed "Send out" into the sentence the user reads: route codes here, everything else as for a swap.
import { ApiFailure } from '../../../core/client/api';
import type { TextKey } from '../i18n';
import { codeKey, errorKey } from '../swap/errors';

const ROUTE_CODES = ['below_route_min', 'route_unavailable', 'route_paused'] as const;

export function outCodeKey(code: string): TextKey {
  return (ROUTE_CODES as readonly string[]).includes(code) ? (`out.err.${code}` as TextKey) : codeKey(code);
}

export function outErrorKey(e: unknown): TextKey {
  if (e instanceof ApiFailure) return outCodeKey(e.code);
  return errorKey(e);
}
