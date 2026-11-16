import { makeApi } from '../../core/client/api';
import { fetchConfig } from './config';

/**
 * The server API for this page (same origin). A request that takes longer than health.requestTimeoutSeconds is
 * abandoned, and the caller gets the same "server could not be reached" failure as when it is offline.
 */
export const api = makeApi(async (input, init) => {
  const seconds = (await fetchConfig().catch(() => null))?.health.requestTimeoutSeconds;
  return fetch(input, seconds ? { ...init, signal: AbortSignal.timeout(seconds * 1000) } : init);
});
