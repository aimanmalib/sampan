// Turns a failed swap into the sentence the user reads. Codes come from the server API and the browser check.
import { ApiFailure } from '../../../core/client/api';
import { CheckFailure } from '../../../core/client/swap';
import type { TextKey } from '../i18n';

const KNOWN = ['below_min', 'above_max', 'no_liquidity', 'not_enough_funds', 'price_moved', 'gave_up', 'offline', 'rejected', 'rate_limited'] as const;

export function errorKey(e: unknown): TextKey {
  if (e instanceof CheckFailure) return 'swap.err.check';
  if (e instanceof ApiFailure) return codeKey(e.code);
  return 'swap.err.wallet';
}

export function codeKey(code: string): TextKey {
  return (KNOWN as readonly string[]).includes(code) ? (`swap.err.${code}` as TextKey) : 'swap.err.generic';
}
