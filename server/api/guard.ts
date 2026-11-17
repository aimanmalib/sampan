// Shared request plumbing: per-caller rate limits and one mapping from domain errors to HTTP answers.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SampanConfig } from '../../core/config.js';
import { ChainUnavailableError } from '../chain/types.js';
import { RouteError } from '../routes/types.js';
import { ScanInputError } from '../scan.js';
import type { Services } from '../services.js';
import { SwapError } from '../swap.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const MINUTE = 60_000;
export const HOUR = 3_600_000;

export function limit(s: Services, req: FastifyRequest, name: string, max: number, windowMs: number): void {
  const who = s.clientIp.of(req.socket.remoteAddress, req.headers);
  if (!s.limiter.hit(`${name}:${who}`, max, windowMs)) throw new ApiError(429, 'rate_limited', 'too many requests; try again shortly');
}

export const quoteLimit = (s: Services, c: SampanConfig, req: FastifyRequest): void => limit(s, req, 'quote', c.rate.quotesPerMinute, MINUTE);
export const crossingLimit = (s: Services, c: SampanConfig, req: FastifyRequest): void =>
  limit(s, req, 'crossing', c.rate.crossingsPerHour, HOUR);

/**
 * Before a new crossing is quoted or planned: visitors from compliance.blockedCountries get 451 (country from
 * cf-ipcountry, believed only through Cloudflare), and a route the last health check saw halted is paused.
 * Static pages, the Swap tab and landing addresses never pass through here.
 */
export function crossingGate(s: Services, c: SampanConfig, req: FastifyRequest): void {
  const cc = s.clientIp.country(req.socket.remoteAddress, req.headers);
  if (cc && c.compliance.blockedCountries.includes(cc))
    throw new ApiError(451, 'restricted_region', 'crossings to and from other chains are not offered in your region');
  if (!s.health.routeOpen()) throw new RouteError('route_paused', 'the route reports this chain halted; crossings are paused');
}

const SWAP_STATUS: Record<SwapError['code'], number> = {
  bad_request: 400,
  below_min: 400,
  above_max: 400,
  no_liquidity: 422,
  not_enough_funds: 422,
  price_moved: 409,
  build_failed: 502,
};

const ROUTE_STATUS: Record<RouteError['code'], number> = { bad_request: 400, below_route_min: 400, route_paused: 503, chain_halted: 503, route_unavailable: 503 };

export function sendError(reply: FastifyReply, e: unknown): FastifyReply {
  if (e instanceof ApiError) return reply.code(e.status).send({ error: e.code, message: e.message });
  if (e instanceof SwapError) return reply.code(SWAP_STATUS[e.code]).send({ error: e.code, message: e.message });
  if (e instanceof RouteError) return reply.code(ROUTE_STATUS[e.code]).send({ error: e.code, message: e.message });
  if (e instanceof ScanInputError) return reply.code(400).send({ error: 'bad_request', message: e.message });
  if (e instanceof ChainUnavailableError) return reply.code(503).send({ error: 'chain_unavailable', message: 'Bitcoin Cash servers are not answering' });
  if (e instanceof Error && /indexer/i.test(e.message)) return reply.code(503).send({ error: 'pools_unavailable', message: 'Cauldron pools are not available' });
  reply.log.error(e);
  return reply.code(500).send({ error: 'internal', message: 'something went wrong on the server' });
}
