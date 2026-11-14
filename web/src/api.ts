import { makeApi } from '../../core/client/api';

/** The server API for this page (same origin). */
export const api = makeApi((input, init) => fetch(input, init));
